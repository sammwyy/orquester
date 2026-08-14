use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const REPOSITORY: &str = "sammwyy/orquester";

/// Handles the second half of an update in a fresh process, which is required
/// on Windows because the running executable cannot be replaced in place.
pub fn handle(args: &[String]) -> Option<i32> {
    if args.first().map(String::as_str) != Some("--self-update-apply") {
        return None;
    }
    let target = value(args, "--self-update-target")?;
    let pid: u32 = value(args, "--self-update-pid")?.parse().ok()?;
    let original_args = args
        .windows(2)
        .filter(|pair| pair[0] == "--self-update-arg")
        .map(|pair| pair[1].clone())
        .collect::<Vec<_>>();
    let staged = value(args, "--self-update-staged")?;

    std::thread::spawn(move || {
        if wait_for_process(pid) {
            eprintln!("Worker update could not replace the executable because the old process is still running.");
            return;
        }
        let target_path = PathBuf::from(target);
        let staged_path = PathBuf::from(staged);
        if let Err(error) = replace_binary(&staged_path, &target_path) {
            eprintln!("Worker update could not replace the executable: {error}");
            return;
        }
        let _ = Command::new(&target_path).args(original_args).spawn();
    });
    Some(0)
}

fn value(args: &[String], key: &str) -> Option<String> {
    args.windows(2).find(|pair| pair[0] == key).map(|pair| pair[1].clone())
}

fn wait_for_process(pid: u32) -> bool {
    for _ in 0..100 {
        if !process_exists(pid) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    true
}

#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    Command::new("kill").args(["-0", &pid.to_string()]).status().map(|status| status.success()).unwrap_or(false)
}

#[cfg(windows)]
fn process_exists(pid: u32) -> bool {
    Command::new("tasklist").args(["/FI", &format!("PID eq {pid}")]).output().map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())).unwrap_or(false)
}

#[cfg(not(any(unix, windows)))]
fn process_exists(_pid: u32) -> bool {
    false
}

fn replace_binary(staged: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    if target.exists() {
        std::fs::remove_file(target)?;
    }
    std::fs::rename(staged, target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

pub async fn update() -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Self-update is disabled in debug builds.".to_string());
    }
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let release_text = reqwest::Client::new()
        .get(format!("https://api.github.com/repos/{REPOSITORY}/releases?per_page=100"))
        .header("accept", "application/vnd.github+json")
        .header("user-agent", "orquester-worker")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    let release: serde_json::Value = serde_json::from_str(&release_text).map_err(|error| error.to_string())?;
    let releases = release.as_array().ok_or_else(|| "Invalid release response.".to_string())?;
    let version = releases
        .iter()
        .find(|release| release.get("prerelease").and_then(|value| value.as_bool()) != Some(true))
        .and_then(|release| release.get("tag_name").and_then(|value| value.as_str()))
        .and_then(|tag| tag.strip_prefix("worker-v"))
        .ok_or_else(|| "No stable worker release is available.".to_string())?;
    let platform = if cfg!(windows) { "windows" } else if cfg!(target_os = "linux") { "linux" } else { return Err("No worker artifact is available for this platform.".to_string()) };
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let asset = format!("orquester-worker-{version}-{platform}-x86_64{suffix}");
    let base = format!("https://github.com/{REPOSITORY}/releases/download/worker-v{version}/{asset}");
    let client = reqwest::Client::new();
    let (binary, checksum) = tokio::try_join!(
        client.get(&base).header("user-agent", "orquester-worker").send(),
        client.get(format!("{base}.sha256")).header("user-agent", "orquester-worker").send()
    ).map_err(|error| error.to_string())?;
    let bytes = binary.error_for_status().map_err(|error| error.to_string())?.bytes().await.map_err(|error| error.to_string())?;
    let checksum = checksum.error_for_status().map_err(|error| error.to_string())?.text().await.map_err(|error| error.to_string())?;
    let expected = checksum.split_whitespace().next().unwrap_or_default().to_ascii_lowercase();
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if expected.is_empty() || expected != actual {
        return Err("Worker checksum verification failed.".to_string());
    }

    let staged_name = format!(
        "{}.update-{}{}",
        current.file_stem().and_then(|name| name.to_str()).unwrap_or("orquester-worker"),
        version,
        current.extension().and_then(|extension| extension.to_str()).map(|extension| format!(".{extension}")).unwrap_or_default()
    );
    let staged = current.with_file_name(staged_name);
    tokio::fs::write(&staged, &bytes).await.map_err(|error| error.to_string())?;
    #[cfg(unix)]
    tokio::fs::set_permissions(&staged, std::os::unix::fs::PermissionsExt::from_mode(0o755)).await.map_err(|error| error.to_string())?;

    let mut command = Command::new(&staged);
    command.arg("--self-update-apply").arg("--self-update-target").arg(&current).arg("--self-update-staged").arg(&staged).arg("--self-update-pid").arg(std::process::id().to_string());
    for arg in std::env::args().skip(1) {
        command.arg("--self-update-arg").arg(arg);
    }
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}
