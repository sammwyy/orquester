//! Keep-awake integration.
//! Windows uses the native `SetThreadExecutionState` call instead of
//! spawning a background PowerShell process that calls it through
//! `Add-Type`/P-Invoke in a loop. Linux holds a `systemd-inhibit` child
//! process for the duration of the request — the lock is released
//! automatically when that process exits, so disabling is just killing it.

pub async fn is_keep_awake_available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        tokio::process::Command::new("systemd-inhibit")
            .arg("--list")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        false
    }
}

#[cfg(windows)]
mod win {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    /// `ES_CONTINUOUS` keeps the state in effect on this thread until it's
    /// cleared, but the state resets if the thread exits, so a dedicated
    /// thread re-asserts it periodically for the life of the request instead
    /// of relying on a single call outliving anything.
    pub fn run(stop: std::sync::Arc<std::sync::atomic::AtomicBool>) {
        while !stop.load(std::sync::atomic::Ordering::SeqCst) {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
            }
            std::thread::sleep(std::time::Duration::from_secs(25));
        }
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    pub fn spawn_inhibitor() -> Option<std::process::Child> {
        std::process::Command::new("systemd-inhibit")
            .args([
                "--what=idle:sleep:handle-lid-switch",
                "--mode=block",
                "--who=Orquester",
                "--why=Keep awake requested from Orquester",
                "sleep",
                "infinity",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()
    }
}

pub struct KeepAwakeController {
    #[cfg(windows)]
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    #[cfg(windows)]
    handle: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
    #[cfg(target_os = "linux")]
    child: std::sync::Mutex<Option<std::process::Child>>,
    stopped: std::sync::atomic::AtomicBool,
}

pub fn create_keep_awake_controller() -> KeepAwakeController {
    KeepAwakeController {
        #[cfg(windows)]
        stop_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
        #[cfg(windows)]
        handle: std::sync::Mutex::new(None),
        #[cfg(target_os = "linux")]
        child: std::sync::Mutex::new(None),
        stopped: std::sync::atomic::AtomicBool::new(false),
    }
}

impl KeepAwakeController {
    pub fn set_enabled(&self, enabled: bool) {
        if self.stopped.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        self.disable();
        if !enabled {
            return;
        }
        #[cfg(windows)]
        {
            self.stop_flag.store(false, std::sync::atomic::Ordering::SeqCst);
            let stop_flag = self.stop_flag.clone();
            let handle = std::thread::spawn(move || win::run(stop_flag));
            *self.handle.lock().unwrap() = Some(handle);
        }
        #[cfg(target_os = "linux")]
        {
            *self.child.lock().unwrap() = linux::spawn_inhibitor();
        }
    }

    fn disable(&self) {
        #[cfg(windows)]
        {
            self.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
            if let Some(handle) = self.handle.lock().unwrap().take() {
                let _ = handle.join();
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(mut child) = self.child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    pub fn stop(&self) {
        self.stopped.store(true, std::sync::atomic::Ordering::SeqCst);
        self.disable();
    }
}
