//! System resource integration.
//! — uses the `sysinfo` crate for CPU/memory/disk instead of shelling out to
//! `Get-CimInstance` (Windows) or `df` (posix).

use crate::api_types::{CpuUsage, DiskUsage, ResourceUsage, SystemResourcesResponse};
use std::sync::Mutex;
use sysinfo::{Disks, System};

fn usage(total_bytes: u64, free_bytes: u64) -> ResourceUsage {
    let used_bytes = total_bytes.saturating_sub(free_bytes);
    let percentage = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64 * 100.0).round()
    } else {
        0.0
    };
    ResourceUsage {
        used_bytes,
        total_bytes,
        free_bytes,
        percentage,
    }
}

/// Owns a long-lived `System` handle: sysinfo computes CPU percentage as a
/// delta between refreshes, so a fresh `System` per request would always
/// read 0%. Kept across calls (backed by whatever poll cadence the caller
/// uses) so consecutive reads are meaningfully spaced apart.
pub struct SystemResourcesService {
    system: Mutex<System>,
}

impl SystemResourcesService {
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_cpu_usage();
        Self {
            system: Mutex::new(system),
        }
    }

    pub fn read(&self, workspaces_dir: &str) -> SystemResourcesResponse {
        let cpu = {
            let mut system = self.system.lock().unwrap();
            system.refresh_cpu_usage();
            system.refresh_memory();
            CpuUsage {
                percentage: (system.global_cpu_usage() as f64).round(),
                cores: system.cpus().len(),
            }
        };

        let memory = {
            let system = self.system.lock().unwrap();
            usage(system.total_memory(), system.free_memory())
        };

        let disk = read_disk(workspaces_dir);
        SystemResourcesResponse { cpu, memory, disk }
    }
}

fn read_disk(workspaces_dir: &str) -> DiskUsage {
    let disks = Disks::new_with_refreshed_list();
    let workspaces_path = std::path::Path::new(workspaces_dir);
    let best = disks
        .list()
        .iter()
        .filter(|disk| workspaces_path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len());

    match best {
        Some(disk) => {
            let total = disk.total_space();
            let free = disk.available_space();
            let base = usage(total, free);
            DiskUsage {
                used_bytes: base.used_bytes,
                total_bytes: base.total_bytes,
                free_bytes: base.free_bytes,
                percentage: base.percentage,
                mount: disk.mount_point().to_string_lossy().to_string(),
                path: workspaces_dir.to_string(),
            }
        }
        None => DiskUsage {
            used_bytes: 0,
            total_bytes: 0,
            free_bytes: 0,
            percentage: 0.0,
            mount: "unknown".to_string(),
            path: workspaces_dir.to_string(),
        },
    }
}

pub struct SystemResourcesWatcher {
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    workspaces_dir: String,
    service: std::sync::Arc<SystemResourcesService>,
    on_change: std::sync::Arc<dyn Fn(SystemResourcesResponse) + Send + Sync>,
}

const FAST_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

pub fn watch_system_resources(
    workspaces_dir: &str,
    service: std::sync::Arc<SystemResourcesService>,
    on_change: impl Fn(SystemResourcesResponse) + Send + Sync + 'static,
) -> SystemResourcesWatcher {
    SystemResourcesWatcher {
        active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        task: std::sync::Mutex::new(None),
        workspaces_dir: workspaces_dir.to_string(),
        service,
        on_change: std::sync::Arc::new(on_change),
    }
}

impl SystemResourcesWatcher {
    pub fn set_active(&self, active: bool) {
        let was_active = self
            .active
            .swap(active, std::sync::atomic::Ordering::SeqCst);
        if was_active == active {
            return;
        }
        let mut task = self.task.lock().unwrap();
        if active {
            let active_flag = self.active.clone();
            let service = self.service.clone();
            let on_change = self.on_change.clone();
            let workspaces_dir = self.workspaces_dir.clone();
            *task = Some(tokio::spawn(async move {
                let mut previous: Option<String> = None;
                while active_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    // Mutex + sysinfo refresh + a fresh disk listing are all
                    // blocking; the one-shot HTTP handler already offloads
                    // this via spawn_blocking, and this poll loop (every 3s
                    // for as long as any /events client is connected) must
                    // too, or it stalls its tokio worker thread each tick.
                    let service = service.clone();
                    let workspaces_dir = workspaces_dir.clone();
                    let resources = match tokio::task::spawn_blocking(move || service.read(&workspaces_dir)).await {
                        Ok(resources) => resources,
                        Err(_) => break,
                    };
                    let serialized = serde_json::to_string(&resources).unwrap_or_default();
                    if previous.as_ref() != Some(&serialized) {
                        previous = Some(serialized);
                        on_change(resources);
                    }
                    tokio::time::sleep(FAST_INTERVAL).await;
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
