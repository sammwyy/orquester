//! Process manager integration.
//! Built on `sysinfo` instead of a native API or a shelled-out tool — process
//! enumeration and killing are already cross-platform there, unlike ports
//! (needs the native TCP table) or media (needs GSMTC/MPRIS).

use crate::api_types::{ProcessManagerResponse, ProcessNode, SessionSummary};
use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Caps how deep `build_node` recurses. Process trees are a few levels deep
/// in practice; this only exists to bound the walk if a pid's parent chain
/// were ever corrupted into a cycle by a racy reused-pid snapshot.
const MAX_DEPTH: u32 = 64;

/// Owns a long-lived `System` handle for the same reason
/// `SystemResourcesService` does: sysinfo's per-process CPU percentage is a
/// delta between refreshes, so a fresh `System` per call would always read 0%.
pub struct ProcessManagerService {
    system: Mutex<System>,
}

impl Default for ProcessManagerService {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessManagerService {
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All);
        Self { system: Mutex::new(system) }
    }

    /// The whole tree is rooted at this worker's own process: every session
    /// shell is spawned as its direct child, so walking down from here (and
    /// tagging each node with whichever session pid is its nearest ancestor)
    /// covers every session in one pass instead of one call per session.
    pub fn read(&self, sessions: &[SessionSummary]) -> ProcessManagerResponse {
        let mut system = self.system.lock().unwrap();
        system.refresh_processes(ProcessesToUpdate::All);

        let children_by_parent = index_children(&system);
        let session_by_pid: HashMap<u32, String> =
            sessions.iter().filter_map(|session| session.pid.map(|pid| (pid, session.id.clone()))).collect();

        let own_pid = std::process::id();
        let roots = build_node(&system, &children_by_parent, &session_by_pid, own_pid, None, 0).into_iter().collect();
        ProcessManagerResponse { roots }
    }

    /// Kills `pid` and everything currently under it. Only allowed within
    /// this worker's own process tree — same boundary `kill_network_process`
    /// enforces — so a client can never reach an unrelated system process.
    pub fn kill(&self, pid: u32) -> Result<(), String> {
        let mut system = self.system.lock().unwrap();
        system.refresh_processes(ProcessesToUpdate::All);

        let own_pid = std::process::id();
        if pid == own_pid {
            return Err("Cannot stop the Orquester worker itself.".to_string());
        }
        if !descends_from(&system, pid, own_pid) {
            return Err("Process is not managed by this worker.".to_string());
        }

        let children_by_parent = index_children(&system);
        let mut targets = vec![pid];
        let mut stack = vec![pid];
        while let Some(current) = stack.pop() {
            for &child in children_by_parent.get(&current).into_iter().flatten() {
                targets.push(child);
                stack.push(child);
            }
        }
        for target_pid in targets {
            if let Some(process) = system.process(Pid::from_u32(target_pid)) {
                process.kill();
            }
        }
        Ok(())
    }
}

/// On Linux, sysinfo also walks `/proc/[pid]/task` and surfaces each thread
/// as its own pseudo-process (parented to the real process) — without this
/// filter, every multi-threaded process, starting with this worker itself,
/// would show dozens of fake "children" that are really just its own threads.
fn index_children(system: &System) -> HashMap<u32, Vec<u32>> {
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for process in system.processes().values() {
        if process.thread_kind().is_some() {
            continue;
        }
        if let Some(parent) = process.parent() {
            children_by_parent.entry(parent.as_u32()).or_default().push(process.pid().as_u32());
        }
    }
    children_by_parent
}

fn descends_from(system: &System, pid: u32, root_pid: u32) -> bool {
    let mut current = Some(Pid::from_u32(pid));
    let mut hops = 0u32;
    while let Some(current_pid) = current {
        if current_pid.as_u32() == root_pid {
            return true;
        }
        hops += 1;
        if hops > 4096 {
            return false;
        }
        current = system.process(current_pid).and_then(|process| process.parent());
    }
    false
}

fn build_node(
    system: &System,
    children_by_parent: &HashMap<u32, Vec<u32>>,
    session_by_pid: &HashMap<u32, String>,
    pid: u32,
    inherited_session_id: Option<&str>,
    depth: u32,
) -> Option<ProcessNode> {
    let process = system.process(Pid::from_u32(pid))?;
    let own_session_id = session_by_pid.get(&pid).map(String::as_str);
    let session_id = own_session_id.or(inherited_session_id);

    let children = if depth >= MAX_DEPTH {
        Vec::new()
    } else {
        let mut nodes: Vec<ProcessNode> = children_by_parent
            .get(&pid)
            .into_iter()
            .flatten()
            .filter_map(|&child_pid| build_node(system, children_by_parent, session_by_pid, child_pid, session_id, depth + 1))
            .collect();
        nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        nodes
    };

    let name = process.name().to_string_lossy().into_owned();
    let command = process.cmd().iter().map(|part| part.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
    Some(ProcessNode {
        pid,
        command: if command.is_empty() { name.clone() } else { command },
        name,
        cpu_percentage: process.cpu_usage() as f64,
        memory_bytes: process.memory(),
        session_id: session_id.map(str::to_string),
        is_session_root: own_session_id.is_some(),
        children,
    })
}

pub struct ProcessManagerWatcher {
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    service: std::sync::Arc<ProcessManagerService>,
    get_sessions: std::sync::Arc<dyn Fn() -> Vec<SessionSummary> + Send + Sync>,
    on_change: std::sync::Arc<dyn Fn(ProcessManagerResponse) + Send + Sync>,
}

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

pub fn watch_process_manager(
    service: std::sync::Arc<ProcessManagerService>,
    get_sessions: impl Fn() -> Vec<SessionSummary> + Send + Sync + 'static,
    on_change: impl Fn(ProcessManagerResponse) + Send + Sync + 'static,
) -> ProcessManagerWatcher {
    ProcessManagerWatcher {
        active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        task: std::sync::Mutex::new(None),
        service,
        get_sessions: std::sync::Arc::new(get_sessions),
        on_change: std::sync::Arc::new(on_change),
    }
}

impl ProcessManagerWatcher {
    pub fn set_active(&self, active: bool) {
        let was_active = self.active.swap(active, std::sync::atomic::Ordering::SeqCst);
        if was_active == active {
            return;
        }
        let mut task = self.task.lock().unwrap();
        if active {
            let active_flag = self.active.clone();
            let service = self.service.clone();
            let get_sessions = self.get_sessions.clone();
            let on_change = self.on_change.clone();
            *task = Some(tokio::spawn(async move {
                let mut previous: Option<String> = None;
                while active_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    let service = service.clone();
                    let sessions = get_sessions();
                    // sysinfo's process refresh reads /proc per-pid; blocking, like
                    // the system-resources poll loop.
                    let status = match tokio::task::spawn_blocking(move || service.read(&sessions)).await {
                        Ok(status) => status,
                        Err(_) => break,
                    };
                    let serialized = serde_json::to_string(&status).unwrap_or_default();
                    if previous.as_ref() != Some(&serialized) {
                        previous = Some(serialized);
                        on_change(status);
                    }
                    tokio::time::sleep(POLL_INTERVAL).await;
                }
            }));
        } else if let Some(handle) = task.take() {
            handle.abort();
        }
    }

    pub fn stop(&self) {
        self.set_active(false);
    }
}
