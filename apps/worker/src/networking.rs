//! Networking integration.
//! — Windows uses the native IP Helper table + a toolhelp process snapshot
//! instead of shelling out to `Get-NetTCPConnection`/`Get-CimInstance
//! Win32_Process` through PowerShell. `killNetworkProcess` still shells out
//! to `taskkill /T /F`, same as the TS worker (it's already the simplest
//! correct way to kill a process tree on Windows).

use crate::api_types::{NetworkPort, NetworkStatusResponse, SessionSummary};
use std::collections::{HashMap, HashSet};

/// Every session pid, plus this worker's own pid, are the roots a listening
/// port's owning process must descend from to be reported.
fn root_pids(sessions: &[SessionSummary]) -> HashMap<u32, String> {
    let mut roots = HashMap::new();
    roots.insert(std::process::id(), String::new());
    for session in sessions {
        if let Some(pid) = session.pid {
            roots.insert(pid, session.id.clone());
        }
    }
    roots
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, HANDLE};
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, MIB_TCP_STATE_LISTEN, TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows::Win32::Networking::WinSock::AF_INET;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    struct ProcessInfo {
        ppid: u32,
        name: String,
    }

    fn snapshot_processes() -> HashMap<u32, ProcessInfo> {
        let mut processes = HashMap::new();
        // SAFETY: standard toolhelp snapshot usage; handle is closed below,
        // and PROCESSENTRY32W's dwSize is set before every Process32*W call
        // per the documented contract.
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return processes };
            let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                    processes.insert(entry.th32ProcessID, ProcessInfo { ppid: entry.th32ParentProcessID, name });
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        processes
    }

    fn descendants(roots: &HashMap<u32, String>, processes: &HashMap<u32, ProcessInfo>) -> HashMap<u32, String> {
        let mut allowed = roots.clone();
        let mut changed = true;
        while changed {
            changed = false;
            for (&pid, info) in processes {
                if !allowed.contains_key(&pid) {
                    if let Some(session_id) = allowed.get(&info.ppid).cloned() {
                        allowed.insert(pid, session_id);
                        changed = true;
                    }
                }
            }
        }
        allowed
    }

    fn listening_ports() -> Vec<(u32, u16)> {
        let mut size = 0u32;
        // SAFETY: first call with a null buffer per the documented pattern to
        // learn the required size, then a real call into a buffer of exactly
        // that size.
        unsafe {
            let _ = GetExtendedTcpTable(None, &mut size, false, AF_INET.0 as u32, TCP_TABLE_OWNER_PID_LISTENER, 0);
            if size == 0 {
                return Vec::new();
            }
            let mut buffer = vec![0u8; size as usize];
            let result = GetExtendedTcpTable(Some(buffer.as_mut_ptr() as *mut _), &mut size, false, AF_INET.0 as u32, TCP_TABLE_OWNER_PID_LISTENER, 0);
            if result != 0 {
                return Vec::new();
            }
            let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
            let count = table.dwNumEntries as usize;
            let rows = std::slice::from_raw_parts(table.table.as_ptr(), count);
            rows.iter()
                .filter(|row| row.dwState == MIB_TCP_STATE_LISTEN.0 as u32)
                .map(|row| {
                    let port = u16::from_be(row.dwLocalPort as u16);
                    (row.dwOwningPid, port)
                })
                .collect()
        }
    }

    pub fn read_ports(sessions: &[SessionSummary]) -> Vec<NetworkPort> {
        let roots = root_pids(sessions);
        let processes = snapshot_processes();
        let allowed = descendants(&roots, &processes);
        let own_pid = std::process::id();

        listening_ports()
            .into_iter()
            .filter(|(pid, _)| *pid != own_pid && allowed.contains_key(pid))
            .map(|(pid, port)| NetworkPort {
                protocol: "tcp".to_string(),
                address: "0.0.0.0".to_string(),
                port,
                pid,
                process: processes.get(&pid).map(|p| p.name.clone()).unwrap_or_else(|| "process".to_string()),
                session_id: allowed.get(&pid).filter(|id| !id.is_empty()).cloned(),
            })
            .collect()
    }
}

pub async fn read_network_status(sessions: &[SessionSummary]) -> NetworkStatusResponse {
    #[cfg(windows)]
    {
        let sessions = sessions.to_vec();
        let ports = tokio::task::spawn_blocking(move || win::read_ports(&sessions)).await.unwrap_or_default();
        NetworkStatusResponse { ports }
    }
    #[cfg(not(windows))]
    {
        let _ = sessions;
        NetworkStatusResponse { ports: Vec::new() }
    }
}

pub async fn kill_network_process(pid: u32, sessions: &[SessionSummary]) -> Result<(), String> {
    let status = read_network_status(sessions).await;
    if !status.ports.iter().any(|p| p.pid == pid) {
        return Err("Process is not an Orquester child or no longer owns a listening port.".to_string());
    }
    #[cfg(windows)]
    {
        let mut command = tokio::process::Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
        command.output().await.map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = tokio::process::Command::new("kill").arg(pid.to_string()).output().await;
    }
    Ok(())
}

pub struct NetworkingWatcher {
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    get_sessions: std::sync::Arc<dyn Fn() -> Vec<SessionSummary> + Send + Sync>,
    on_change: std::sync::Arc<dyn Fn(NetworkStatusResponse) + Send + Sync>,
}

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

pub fn watch_networking(
    get_sessions: impl Fn() -> Vec<SessionSummary> + Send + Sync + 'static,
    on_change: impl Fn(NetworkStatusResponse) + Send + Sync + 'static,
) -> NetworkingWatcher {
    NetworkingWatcher {
        active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        task: std::sync::Mutex::new(None),
        get_sessions: std::sync::Arc::new(get_sessions),
        on_change: std::sync::Arc::new(on_change),
    }
}

impl NetworkingWatcher {
    pub fn set_active(&self, active: bool) {
        let was_active = self.active.swap(active, std::sync::atomic::Ordering::SeqCst);
        if was_active == active {
            return;
        }
        let mut task = self.task.lock().unwrap();
        if active {
            let active_flag = self.active.clone();
            let get_sessions = self.get_sessions.clone();
            let on_change = self.on_change.clone();
            *task = Some(tokio::spawn(async move {
                let mut previous: Option<String> = None;
                while active_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    let status = read_network_status(&get_sessions()).await;
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
