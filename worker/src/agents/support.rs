//! Shared low-level helpers used by more than one provider: running a CLI to
//! completion and capturing its output, driving an interactive PTY session
//! until a stop condition matches, stripping terminal escape sequences, and
//! the shared "quota not supported" response.

use crate::api_types::{RegistryActionResult, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use std::path::{Path, PathBuf};

/// Where each CLI's own state directory (`.claude`, `.grok`, ...) lives.
pub fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok().map(PathBuf::from)
}

/// Collapses whitespace/newlines to single spaces and trims to `max_chars`
/// (char-safe), for turning a raw prompt/message into a one-line title.
pub fn summarize(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let truncated: String = collapsed.chars().take(max_chars).collect();
    format!("{}…", truncated.trim_end())
}

pub fn unsupported_quota(id: &str, provider: &str, message: Option<&str>) -> RegistryQuota {
    RegistryQuota {
        id: id.to_string(),
        provider: provider.to_string(),
        auth: RegistryAuthInfo {
            status: RegistryAuthStatus::Unknown,
            account: None,
            message: Some("Authentication status is not exposed by this provider.".to_string()),
        },
        supported: false,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        windows: Vec::new(),
        message: Some(message.unwrap_or("This provider does not expose quota usage through its CLI yet.").to_string()),
    }
}

pub async fn call(bin: &Path, args: &[&str]) -> RegistryActionResult {
    let mut command = tokio::process::Command::new(bin);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match command.output().await {
        Ok(output) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            RegistryActionResult { ok: output.status.success(), exit_code: output.status.code().unwrap_or(1), output: combined }
        }
        Err(error) => RegistryActionResult { ok: false, exit_code: 1, output: error.to_string() },
    }
}

/// Strips ANSI/OSC/DCS terminal escape sequences, same three patterns the TS
/// worker strips before regex-matching the PTY's raw output.
pub fn strip_ansi(input: &str) -> String {
    static OSC: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static DCS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static CSI: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let osc = OSC.get_or_init(|| regex::Regex::new("\u{1b}\\][^\u{7}]*(?:\u{7}|\u{1b}\\\\)").unwrap());
    let dcs = DCS.get_or_init(|| regex::Regex::new("\u{1b}_[^\u{1b}]*\u{1b}\\\\").unwrap());
    let csi = CSI.get_or_init(|| regex::Regex::new("\u{1b}\\[[0-?]*[ -/]*[@-~]").unwrap());
    let step1 = osc.replace_all(input, "");
    let step2 = dcs.replace_all(&step1, "");
    let step3 = csi.replace_all(&step2, "");
    step3.replace('\r', "")
}

/// Drives an interactive PTY session (portable-pty, same crate sessions.rs
/// uses) until `stop_when` matches the accumulated output, then sends Ctrl+C
/// and gives it 250ms to wind down. 20s overall timeout. Mirrors the TS
/// worker's interactive agent-command driver.
pub async fn call_interactive(bin: &Path, args: &[&str], stop_when: &regex::Regex) -> Result<String, String> {
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = portable_pty::CommandBuilder::new(bin);
    for arg in args {
        cmd.arg(arg);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(chunk[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    const MAX_BUFFER: usize = 64_000;
    let mut output: Vec<u8> = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(chunk)) => {
                output.extend_from_slice(&chunk);
                if output.len() > MAX_BUFFER {
                    let excess = output.len() - MAX_BUFFER;
                    output.drain(0..excess);
                }
                let text = String::from_utf8_lossy(&output);
                if stop_when.is_match(&text) {
                    use std::io::Write as _;
                    let _ = writer.write_all(b"\x03");
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
    let _ = child.kill();
    Ok(String::from_utf8_lossy(&output).into_owned())
}
