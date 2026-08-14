//! Networking integration.
//! Windows uses the native IP Helper table; Linux reads procfs. Both avoid a
//! dependency on a command-line networking tool being installed.

use crate::api_types::{NetworkPort, NetworkStatusResponse, SessionSummary};
use std::collections::HashMap;

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
    use windows::Win32::Foundation::CloseHandle;
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

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use sysinfo::{Pid, ProcessesToUpdate, System};

    #[derive(Clone)]
    struct SocketOwner {
        pid: u32,
        process: String,
        session_id: Option<String>,
    }

    fn descendants(sessions: &[SessionSummary], system: &System) -> HashMap<u32, String> {
        let mut allowed = root_pids(sessions);
        let mut changed = true;
        while changed {
            changed = false;
            for process in system.processes().values() {
                let pid = process.pid().as_u32();
                if allowed.contains_key(&pid) {
                    continue;
                }
                if let Some(session_id) = process
                    .parent()
                    .and_then(|parent| allowed.get(&parent.as_u32()))
                    .cloned()
                {
                    allowed.insert(pid, session_id);
                    changed = true;
                }
            }
        }
        allowed
    }

    fn socket_inode(target: &std::path::Path) -> Option<u64> {
        let target = target.to_string_lossy();
        target
            .strip_prefix("socket:[")?
            .strip_suffix(']')?
            .parse()
            .ok()
    }

    fn socket_owners(allowed: &HashMap<u32, String>, system: &System) -> HashMap<u64, SocketOwner> {
        let mut owners = HashMap::new();
        let own_pid = std::process::id();
        for (&pid, session_id) in allowed {
            if pid == own_pid {
                continue;
            }
            let Some(process) = system.process(Pid::from_u32(pid)) else {
                continue;
            };
            let process_name = process.name().to_string_lossy().into_owned();
            let Ok(entries) = fs::read_dir(format!("/proc/{pid}/fd")) else {
                continue;
            };
            for entry in entries.flatten() {
                let Some(inode) = fs::read_link(entry.path())
                    .ok()
                    .as_deref()
                    .and_then(socket_inode)
                else {
                    continue;
                };
                owners.entry(inode).or_insert_with(|| SocketOwner {
                    pid,
                    process: process_name.clone(),
                    session_id: (!session_id.is_empty()).then(|| session_id.clone()),
                });
            }
        }
        owners
    }

    fn decode_address(value: &str, ipv6: bool) -> Option<(String, u16)> {
        let (address, port) = value.split_once(':')?;
        let port = u16::from_str_radix(port, 16).ok()?;
        let address = if ipv6 {
            if address.len() != 32 {
                return None;
            }
            let mut bytes = [0u8; 16];
            for (chunk, destination) in address
                .as_bytes()
                .chunks_exact(8)
                .zip(bytes.chunks_exact_mut(4))
            {
                for (source, destination) in chunk.chunks_exact(2).zip(destination.iter_mut().rev())
                {
                    *destination =
                        u8::from_str_radix(std::str::from_utf8(source).ok()?, 16).ok()?;
                }
            }
            Ipv6Addr::from(bytes).to_string()
        } else {
            if address.len() != 8 {
                return None;
            }
            let mut bytes = [0u8; 4];
            for (source, destination) in address
                .as_bytes()
                .chunks_exact(2)
                .zip(bytes.iter_mut().rev())
            {
                *destination = u8::from_str_radix(std::str::from_utf8(source).ok()?, 16).ok()?;
            }
            Ipv4Addr::from(bytes).to_string()
        };
        Some((address, port))
    }

    fn listening_sockets(path: &str, ipv6: bool) -> Vec<(String, u16, u64)> {
        let Ok(contents) = fs::read_to_string(path) else {
            return Vec::new();
        };
        contents
            .lines()
            .skip(1)
            .filter_map(|line| {
                let fields: Vec<_> = line.split_whitespace().collect();
                if fields.get(3) != Some(&"0A") {
                    return None;
                }
                let (address, port) = decode_address(*fields.get(1)?, ipv6)?;
                let inode = fields.get(9)?.parse().ok()?;
                Some((address, port, inode))
            })
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn decodes_procfs_listener_addresses() {
            assert_eq!(
                decode_address("0100007F:1F90", false),
                Some(("127.0.0.1".to_string(), 8080))
            );
            assert_eq!(
                decode_address("00000000000000000000000001000000:1F90", true),
                Some(("::1".to_string(), 8080))
            );
        }
    }

    pub fn read_ports(sessions: &[SessionSummary]) -> Vec<NetworkPort> {
        let mut system = System::new_all();
        system.refresh_processes(ProcessesToUpdate::All);
        let owners = socket_owners(&descendants(sessions, &system), &system);
        let mut ports: Vec<_> = listening_sockets("/proc/net/tcp", false)
            .into_iter()
            .chain(listening_sockets("/proc/net/tcp6", true))
            .filter_map(|(address, port, inode)| {
                let owner = owners.get(&inode)?;
                Some(NetworkPort {
                    protocol: "tcp".to_string(),
                    address,
                    port,
                    pid: owner.pid,
                    process: owner.process.clone(),
                    session_id: owner.session_id.clone(),
                })
            })
            .collect();
        ports.sort_by(|left, right| {
            left.port
                .cmp(&right.port)
                .then(left.pid.cmp(&right.pid))
                .then(left.address.cmp(&right.address))
        });
        ports
    }
}

pub async fn read_network_status(sessions: &[SessionSummary]) -> NetworkStatusResponse {
    #[cfg(windows)]
    {
        let sessions = sessions.to_vec();
        let ports = tokio::task::spawn_blocking(move || win::read_ports(&sessions)).await.unwrap_or_default();
        NetworkStatusResponse { ports }
    }
    #[cfg(target_os = "linux")]
    {
        let sessions = sessions.to_vec();
        let ports = tokio::task::spawn_blocking(move || linux::read_ports(&sessions))
            .await
            .unwrap_or_default();
        NetworkStatusResponse { ports }
    }
    #[cfg(all(not(windows), not(target_os = "linux")))]
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
