use std::process::Command;

#[cfg(target_os = "linux")]
use std::path::PathBuf;

#[cfg(windows)]
const WINDOWS_TASK_NAME: &str = "Orquester Worker";
#[cfg(target_os = "linux")]
const LINUX_UNIT_NAME: &str = "orquester-worker.service";

pub fn handle(args: &[String], appdir: Option<&str>) -> Option<i32> {
    if args.first().map(String::as_str) != Some("service") {
        return None;
    }

    let result = match args.get(1).map(String::as_str) {
        Some("install") => install(appdir),
        Some("uninstall") => uninstall(),
        Some("status") => status(),
        _ => Err(
            "Usage: orquester-worker service <install|uninstall|status> [--appdir <path>]"
                .to_string(),
        ),
    };
    match result {
        Ok(message) => {
            println!("{message}");
            Some(0)
        }
        Err(error) => {
            eprintln!("{error}");
            Some(1)
        }
    }
}

#[cfg(windows)]
fn install(appdir: Option<&str>) -> Result<String, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = format!("\"{}\"", executable.display());
    if let Some(appdir) = appdir {
        command.push_str(&format!(" --appdir \"{appdir}\""));
    }
    run(
        "schtasks",
        [
            "/Create",
            "/TN",
            WINDOWS_TASK_NAME,
            "/SC",
            "ONLOGON",
            "/TR",
            &command,
            "/F",
        ],
    )?;
    Ok("Worker starts when you sign in.".to_string())
}

#[cfg(windows)]
fn uninstall() -> Result<String, String> {
    if !windows_task_exists() {
        return Ok("Worker sign-in startup is not installed.".to_string());
    }
    run("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"])?;
    Ok("Worker sign-in startup removed.".to_string())
}

#[cfg(windows)]
fn status() -> Result<String, String> {
    Ok(if windows_task_exists() {
        "installed"
    } else {
        "not installed"
    }
    .to_string())
}

#[cfg(windows)]
fn windows_task_exists() -> bool {
    Command::new("schtasks")
        .args(["/Query", "/TN", WINDOWS_TASK_NAME])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn install(appdir: Option<&str>) -> Result<String, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let unit_path = linux_unit_path()?;
    let mut arguments = Vec::new();
    if let Some(appdir) = appdir {
        arguments.push("--appdir".to_string());
        arguments.push(appdir.to_string());
    }
    let exec_start = std::iter::once(executable.to_string_lossy().into_owned())
        .chain(arguments)
        .map(|argument| systemd_argument(&argument))
        .collect::<Vec<_>>()
        .join(" ");
    let unit = format!("[Unit]\nDescription=Orquester Worker\n\n[Service]\nExecStart={exec_start}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n");
    if let Some(parent) = unit_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&unit_path, unit).map_err(|error| error.to_string())?;
    run("systemctl", ["--user", "daemon-reload"])?;
    run("systemctl", ["--user", "enable", LINUX_UNIT_NAME])?;
    Ok("Worker starts when you sign in.".to_string())
}

#[cfg(target_os = "linux")]
fn uninstall() -> Result<String, String> {
    let _ = Command::new("systemctl")
        .args(["--user", "disable", "--now", LINUX_UNIT_NAME])
        .status();
    let unit_path = linux_unit_path()?;
    if unit_path.exists() {
        std::fs::remove_file(unit_path).map_err(|error| error.to_string())?;
    }
    run("systemctl", ["--user", "daemon-reload"])?;
    Ok("Worker sign-in startup removed.".to_string())
}

#[cfg(target_os = "linux")]
fn status() -> Result<String, String> {
    Ok(if linux_unit_path()?.exists() {
        "installed"
    } else {
        "not installed"
    }
    .to_string())
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn install(_appdir: Option<&str>) -> Result<String, String> {
    Err("Worker service management is only supported on Windows and Linux.".to_string())
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn uninstall() -> Result<String, String> {
    Err("Worker service management is only supported on Windows and Linux.".to_string())
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn status() -> Result<String, String> {
    Err("Worker service management is only supported on Windows and Linux.".to_string())
}

#[cfg(target_os = "linux")]
fn linux_unit_path() -> Result<PathBuf, String> {
    let config_dir = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "Cannot resolve the user configuration directory.".to_string())?;
    Ok(config_dir
        .join("systemd")
        .join("user")
        .join(LINUX_UNIT_NAME))
}

#[cfg(target_os = "linux")]
fn systemd_argument(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('%', "%%")
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}

fn run<const N: usize>(program: &str, arguments: [&str; N]) -> Result<(), String> {
    let output = Command::new(program)
        .args(arguments)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        format!("{program} failed.")
    } else {
        message
    })
}
