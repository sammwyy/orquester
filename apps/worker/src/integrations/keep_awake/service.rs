//! Keep-awake integration.
//! — Windows uses the native `SetThreadExecutionState` call instead of
//! spawning a background PowerShell process that calls it through
//! `Add-Type`/P-Invoke in a loop.

pub async fn is_keep_awake_available() -> bool {
    cfg!(windows)
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

pub struct KeepAwakeController {
    stop_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    handle: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
    stopped: std::sync::atomic::AtomicBool,
}

pub fn create_keep_awake_controller() -> KeepAwakeController {
    KeepAwakeController {
        stop_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
        handle: std::sync::Mutex::new(None),
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
    }

    fn disable(&self) {
        self.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    pub fn stop(&self) {
        self.stopped.store(true, std::sync::atomic::Ordering::SeqCst);
        self.disable();
    }
}
