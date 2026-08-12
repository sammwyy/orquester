//! Battery integration.
//! Windows uses the native `GetSystemPowerStatus` call instead of shelling
//! out to `Get-CimInstance Win32_Battery`.

use crate::api_types::BatteryStatusResponse;

fn unavailable() -> BatteryStatusResponse {
    BatteryStatusResponse { has_battery: false, percentage: None, charging: false, plugged_in: false }
}

/// No physical battery: a desktop has no other power source, so it's always
/// on line power.
fn no_battery() -> BatteryStatusResponse {
    BatteryStatusResponse { has_battery: false, percentage: None, charging: false, plugged_in: true }
}

#[cfg(windows)]
fn read_windows_battery() -> BatteryStatusResponse {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    // SAFETY: GetSystemPowerStatus just fills a caller-owned struct; no
    // pointers or lifetimes to uphold beyond `status` being valid to write to.
    let ok = unsafe { GetSystemPowerStatus(&mut status) };
    if ok.is_err() {
        return unavailable();
    }

    const BATTERY_FLAG_NO_BATTERY: u8 = 128;
    const BATTERY_FLAG_CHARGING: u8 = 8;
    const BATTERY_PERCENT_UNKNOWN: u8 = 255;

    if status.BatteryFlag == BATTERY_FLAG_NO_BATTERY as u8 || status.BatteryFlag == BATTERY_PERCENT_UNKNOWN {
        return BatteryStatusResponse { has_battery: false, percentage: None, charging: false, plugged_in: status.ACLineStatus == 1 };
    }

    let percentage = if status.BatteryLifePercent == BATTERY_PERCENT_UNKNOWN { None } else { Some(status.BatteryLifePercent as u32) };
    BatteryStatusResponse {
        has_battery: true,
        percentage,
        charging: status.BatteryFlag & BATTERY_FLAG_CHARGING != 0,
        plugged_in: status.ACLineStatus == 1,
    }
}

pub async fn read_battery_status() -> BatteryStatusResponse {
    #[cfg(windows)]
    {
        // GetSystemPowerStatus is a cheap synchronous call; no need for spawn_blocking.
        read_windows_battery()
    }
    #[cfg(not(windows))]
    {
        no_battery()
    }
}

pub struct BatteryWatcher {
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    on_change: std::sync::Arc<dyn Fn(BatteryStatusResponse) + Send + Sync>,
}

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(3);

pub fn watch_battery(on_change: impl Fn(BatteryStatusResponse) + Send + Sync + 'static) -> BatteryWatcher {
    BatteryWatcher { active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)), task: std::sync::Mutex::new(None), on_change: std::sync::Arc::new(on_change) }
}

impl BatteryWatcher {
    pub fn set_active(&self, active: bool) {
        let was_active = self.active.swap(active, std::sync::atomic::Ordering::SeqCst);
        if was_active == active {
            return;
        }
        let mut task = self.task.lock().unwrap();
        if active {
            let active_flag = self.active.clone();
            let on_change = self.on_change.clone();
            *task = Some(tokio::spawn(async move {
                let mut previous: Option<String> = None;
                while active_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    let status = read_battery_status().await;
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
