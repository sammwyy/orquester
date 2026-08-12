//! Host tool registry. Each agent's bespoke quota/auth logic lives in
//! `crate::agents` — this covers the whole catalog (shells, agents, IDEs,
//! file explorers, browsers): resolve a binary on PATH, list, detect version
//! via the `versionFlag` (no provider-specific version detection), and
//! fire-and-forget "open target" launches. Install/update/quota stay behind
//! an honest NOT_IMPLEMENTED in routes/registry.rs where not ported.

mod browsers;
mod editors;
mod explorers;
mod shells;

use crate::api_types::{
    OpenResult, RegistryActionResult, RegistryAuthInfo, RegistryAuthStatus, RegistryEntry, RegistryInstallState, RegistryKind,
    RegistryQuota, RegistryResponse,
};
use crate::broadcaster::Broadcaster;
use browsers::BROWSERS;
use editors::EDITORS;
use explorers::EXPLORERS;
use shells::materialize_shells;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Static IDE, file explorer and browser candidates by platform, before
/// PATH/env resolution.
pub struct HostEntryDef {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static [&'static str],
}

#[derive(Clone)]
struct RuntimeEntry {
    id: String,
    name: String,
    kind: RegistryKind,
    bin: Vec<String>,
    resolved_bin: Option<PathBuf>,
    enabled: bool,
    version: Option<String>,
    version_flag: Option<String>,
    install_command: Option<String>,
    update_command: Option<String>,
    website_url: Option<String>,
    missing_dependencies: Vec<String>,
    install_state: RegistryInstallState,
    install_error: Option<String>,
}

fn to_public(entry: &RuntimeEntry) -> RegistryEntry {
    RegistryEntry {
        id: entry.id.clone(),
        name: entry.name.clone(),
        kind: entry.kind,
        enabled: entry.enabled,
        version: entry.version.clone(),
        can_install: entry.install_command.is_some(),
        can_update: entry.update_command.is_some(),
        install_command: entry.install_command.clone(),
        website_url: entry.website_url.clone(),
        missing_dependencies: entry.missing_dependencies.clone(),
        install_state: entry.install_state,
        install_error: entry.install_error.clone(),
    }
}

/// Expands a registry command template's `$LOCALAPPDATA` / `$PROGRAMFILES` /
/// `$HOME` tokens.
fn expand_tokens(tokens: &[&str]) -> Vec<String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").or_else(|_| std::env::var("ProgramFiles(x86)")).unwrap_or_default();
    tokens
        .iter()
        .filter(|t| !t.is_empty())
        .map(|t| t.replace("$LOCALAPPDATA", &local).replace("$PROGRAMFILES", &program_files).replace("$HOME", &home))
        .collect()
}

fn os_opener() -> Vec<String> {
    if cfg!(windows) {
        vec!["explorer".to_string()]
    } else if cfg!(target_os = "macos") {
        vec!["open".to_string()]
    } else {
        vec!["xdg-open".to_string()]
    }
}

fn is_executable(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path.is_file()
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
}

fn resolve_bin(candidates: &[String]) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string()).split(';').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect()
    } else {
        vec![String::new()]
    };

    for candidate in candidates {
        let candidate_path = Path::new(candidate);
        if candidate_path.is_absolute() && is_executable(candidate_path) {
            return Some(candidate_path.to_path_buf());
        }
        for dir in std::env::split_paths(&path_var) {
            for ext in &exts {
                let full = dir.join(format!("{candidate}{ext}"));
                if is_executable(&full) {
                    return Some(full);
                }
            }
        }
    }
    None
}

fn materialize(defs: &[HostEntryDef], kind: RegistryKind) -> Vec<RuntimeEntry> {
    defs.iter()
        .map(|def| {
            let bin = if def.bin.is_empty() { os_opener() } else { expand_tokens(def.bin) };
            let resolved_bin = resolve_bin(&bin);
            RuntimeEntry {
                id: def.id.to_string(),
                name: def.name.to_string(),
                kind,
                enabled: resolved_bin.is_some(),
                resolved_bin,
                bin,
                version: None,
                version_flag: None,
                install_command: None,
                update_command: None,
                website_url: None,
                missing_dependencies: Vec::new(),
                install_state: RegistryInstallState::Idle,
                install_error: None,
            }
        })
        .collect()
}

fn materialize_agents() -> Vec<RuntimeEntry> {
    crate::agents::AGENT_DEFS
        .iter()
        .map(|def| {
            let bin: Vec<String> = def.bin.iter().map(|b| b.to_string()).collect();
            let resolved_bin = resolve_bin(&bin);
            let missing_dependencies: Vec<String> =
                def.bin_deps.iter().filter(|dep| resolve_bin(&[dep.to_string()]).is_none()).map(|d| d.to_string()).collect();
            RuntimeEntry {
                id: def.id.to_string(),
                name: def.name.to_string(),
                kind: RegistryKind::Agent,
                enabled: resolved_bin.is_some() && missing_dependencies.is_empty(),
                resolved_bin,
                bin,
                version: None,
                version_flag: (!def.version_flag.is_empty()).then(|| def.version_flag.to_string()),
                install_command: (!def.install_cmd.is_empty()).then(|| def.install_cmd.to_string()),
                update_command: (!def.update_cmd.is_empty()).then(|| def.update_cmd.to_string()),
                website_url: (!def.website_url.is_empty()).then(|| def.website_url.to_string()),
                missing_dependencies,
                install_state: RegistryInstallState::Idle,
                install_error: None,
            }
        })
        .collect()
}

/// Wraps a command in a native UAC elevation prompt. Unlike a posix branch
/// (sudo with a piped password prompt), the dialog here is entirely native
/// and out-of-band from our child process.
fn elevate_command_windows(command: &str) -> String {
    let escaped = command.replace('\'', "''");
    format!("powershell -NoProfile -Command \"Start-Process cmd.exe -ArgumentList '/c','{escaped}' -Verb RunAs -Wait\"")
}

/// Run a shell command line to completion, capturing combined output
/// (capped).
async fn run_shell_capture(command_line: &str, timeout: std::time::Duration) -> RegistryActionResult {
    let mut command = tokio::process::Command::new("cmd");
    command.arg("/c").arg(command_line);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            let capped: String = combined.chars().take(64_000).collect();
            RegistryActionResult { ok: output.status.success(), exit_code: output.status.code().unwrap_or(1), output: capped }
        }
        Ok(Err(error)) => RegistryActionResult { ok: false, exit_code: 1, output: error.to_string() },
        Err(_) => RegistryActionResult { ok: false, exit_code: 124, output: "Command timed out.".to_string() },
    }
}

pub struct RegistryService {
    entries: Arc<RwLock<HashMap<String, RuntimeEntry>>>,
    broadcaster: Arc<Broadcaster>,
}

/// Update one entry and broadcast the change. A free function (not a method)
/// so it can run from both `&self` call sites and background tasks that only
/// hold clones of `entries`/`broadcaster`, not the whole service.
async fn patch_entry(
    entries: &RwLock<HashMap<String, RuntimeEntry>>,
    broadcaster: &Broadcaster,
    id: &str,
    f: impl FnOnce(&mut RuntimeEntry),
) {
    let public = {
        let mut entries = entries.write().await;
        let Some(entry) = entries.get_mut(id) else { return };
        f(entry);
        to_public(entry)
    };
    broadcaster.publish("registry", "registry.changed", &public);
}

impl RegistryService {
    pub fn new(broadcaster: Arc<Broadcaster>) -> Self {
        Self { entries: Arc::new(RwLock::new(HashMap::new())), broadcaster }
    }

    pub async fn init(&self) {
        let mut all = materialize_shells();
        all.extend(materialize_agents());
        all.extend(materialize(EDITORS, RegistryKind::Ide));
        all.extend(materialize(EXPLORERS, RegistryKind::FileExplorer));
        all.extend(materialize(BROWSERS, RegistryKind::Browser));

        let mut entries = self.entries.write().await;
        entries.clear();
        for entry in all {
            entries.insert(entry.id.clone(), entry);
        }
    }

    pub async fn list(&self) -> RegistryResponse {
        let entries = self.entries.read().await;
        let by_kind = |kind: RegistryKind| entries.values().filter(|e| e.kind == kind).map(to_public).collect();
        RegistryResponse {
            shells: by_kind(RegistryKind::Shell),
            agents: by_kind(RegistryKind::Agent),
            ides: by_kind(RegistryKind::Ide),
            file_explorers: by_kind(RegistryKind::FileExplorer),
            browsers: by_kind(RegistryKind::Browser),
        }
    }

    /// Runs the entry's `versionFlag` (e.g. `claude --version`) and returns
    /// the first non-empty output line. No provider-specific version
    /// detection (see module doc) — every agent here uses a plain
    /// `--version` flag, which this covers.
    pub async fn version(&self, id: &str) -> RegistryActionResult {
        let entry = {
            let entries = self.entries.read().await;
            entries.get(id).cloned()
        };
        let Some(entry) = entry else {
            return RegistryActionResult { ok: false, exit_code: -1, output: "Unknown registry entry.".to_string() };
        };
        let (Some(bin), Some(flag)) = (entry.resolved_bin, entry.version_flag) else {
            return RegistryActionResult { ok: false, exit_code: -1, output: "No bin or version flag for this entry.".to_string() };
        };

        let mut command = tokio::process::Command::new(&bin);
        command.arg(&flag);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        match command.output().await {
            Ok(output) => {
                let text = String::from_utf8_lossy(if output.status.success() { &output.stdout } else { &output.stderr }).to_string();
                let line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
                if line.is_empty() {
                    RegistryActionResult { ok: false, exit_code: 1, output: "The provider did not return a version.".to_string() }
                } else {
                    patch_entry(&self.entries, &self.broadcaster, id, |e| e.version = Some(line.clone())).await;
                    RegistryActionResult { ok: true, exit_code: 0, output: line }
                }
            }
            Err(error) => RegistryActionResult { ok: false, exit_code: 1, output: error.to_string() },
        }
    }

    /// Ask the (partially ported, see agents/) agent integration for
    /// account/provider quota without exposing credentials. Caches nothing —
    /// the TS worker's cache lives in the route layer via a 30s poll while
    /// clients are connected, which this worker doesn't run yet either.
    pub async fn quota(&self, id: &str) -> RegistryQuota {
        let entry = {
            let entries = self.entries.read().await;
            entries.get(id).cloned()
        };
        let Some(entry) = entry else {
            return crate::agents::unsupported_quota(id, id, Some("Unknown registry entry."));
        };
        if entry.kind != RegistryKind::Agent {
            return crate::agents::unsupported_quota(id, &entry.name, Some("Quota only applies to agents."));
        }
        let Some(bin) = entry.resolved_bin.filter(|_| entry.enabled) else {
            return RegistryQuota {
                id: id.to_string(),
                provider: entry.name,
                auth: RegistryAuthInfo {
                    status: RegistryAuthStatus::Unknown,
                    account: None,
                    message: Some("The agent is not installed or cannot be resolved.".to_string()),
                },
                supported: false,
                fetched_at: chrono::Utc::now().to_rfc3339(),
                windows: Vec::new(),
                message: Some("The agent is not installed or cannot be resolved.".to_string()),
            };
        };
        let mut quota = crate::agents::get_quota(id, &bin, &entry.name).await;
        if let Some(auth) = crate::agents::get_auth_status(id, &bin).await {
            quota.auth = auth;
        }
        quota
    }

    /// Start an install (background); status flows via registry.changed
    /// events. Returns immediately.
    pub async fn install(&self, id: &str, elevated: bool) -> bool {
        self.run_managed(id, true, elevated).await
    }

    /// Start an update (background); never elevated, same as the TS worker.
    pub async fn update(&self, id: &str) -> bool {
        self.run_managed(id, false, false).await
    }

    async fn run_managed(&self, id: &str, install: bool, elevated: bool) -> bool {
        // The "is one already running" check and the "mark it running" write
        // must happen under one lock hold — two separate acquisitions let two
        // concurrent install/update calls both observe Idle and both proceed,
        // double-spawning the same command.
        let (base_command, public) = {
            let mut entries = self.entries.write().await;
            let Some(entry) = entries.get_mut(id) else { return false };
            if entry.install_state == RegistryInstallState::Installing {
                return false;
            }
            let command = if install { entry.install_command.clone() } else { entry.update_command.clone() };
            let Some(base_command) = command else { return false };
            entry.install_state = RegistryInstallState::Installing;
            entry.install_error = None;
            (base_command, to_public(entry))
        };
        self.broadcaster.publish("registry", "registry.changed", &public);

        // Windows-only elevation: wraps the command in a native UAC prompt
        // via Start-Process -Verb RunAs. No password piping needed (unlike
        // the TS worker's posix sudo path) since the OS handles the prompt
        // itself, out-of-band from our child process's stdio.
        let command = if elevated { elevate_command_windows(&base_command) } else { base_command };

        let entries = self.entries.clone();
        let broadcaster = self.broadcaster.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            let result = run_shell_capture(&command, std::time::Duration::from_secs(600)).await;
            if result.ok {
                let bin_candidates = { entries.read().await.get(&id).map(|e| e.bin.clone()) };
                let resolved = bin_candidates.and_then(|bin| resolve_bin(&bin));
                let missing_still: Vec<String> = {
                    let deps = entries.read().await.get(&id).map(|e| e.missing_dependencies.clone()).unwrap_or_default();
                    deps.into_iter().filter(|d| resolve_bin(&[d.clone()]).is_none()).collect()
                };
                patch_entry(&entries, &broadcaster, &id, |e| {
                    e.enabled = resolved.is_some() && missing_still.is_empty();
                    e.resolved_bin = resolved;
                    e.install_state = RegistryInstallState::Idle;
                    e.install_error = None;
                    e.version = None;
                })
                .await;
            } else {
                let tail: String = {
                    let chars: Vec<char> = result.output.chars().collect();
                    let start = chars.len().saturating_sub(4000);
                    chars[start..].iter().collect()
                };
                patch_entry(&entries, &broadcaster, &id, |e| {
                    e.install_state = RegistryInstallState::Error;
                    e.install_error = Some(tail);
                })
                .await;
            }
        });
        true
    }

    /// Windows has no password-piped elevation path (native UAC handles the
    /// prompt), so there is never a pending request to answer or cancel.
    pub async fn provide_install_password(&self, _id: &str, _password: &str) -> bool {
        false
    }

    pub async fn cancel_install_password(&self, _id: &str) -> bool {
        false
    }

    /// The resolved binary + enabled flag for a shell/agent entry, used by
    /// session creation to know what to spawn.
    pub async fn resolved_bin(&self, id: &str) -> Option<(PathBuf, RegistryKind, String)> {
        let entries = self.entries.read().await;
        let entry = entries.get(id)?;
        if !entry.enabled {
            return None;
        }
        Some((entry.resolved_bin.clone()?, entry.kind, entry.name.clone()))
    }

    /// Launch an ide/file-explorer/browser on a path (fire-and-forget).
    pub async fn open_target(&self, target_id: &str, path: &str) -> OpenResult {
        let entries = self.entries.read().await;
        let Some(entry) = entries.get(target_id) else {
            return OpenResult { ok: false, message: Some(format!("Target \"{target_id}\" is not available.")) };
        };
        let (Some(bin), true) = (entry.resolved_bin.clone(), entry.enabled) else {
            return OpenResult { ok: false, message: Some(format!("Target \"{target_id}\" is not available.")) };
        };
        let arg = if entry.kind == RegistryKind::Browser {
            match url::Url::from_file_path(path) {
                Ok(url) => url.to_string(),
                Err(_) => path.to_string(),
            }
        } else {
            path.to_string()
        };
        drop(entries);

        let mut command = tokio::process::Command::new(&bin);
        command.arg(&arg);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        match command.spawn() {
            Ok(_child) => OpenResult { ok: true, message: None },
            Err(error) => OpenResult { ok: false, message: Some(error.to_string()) },
        }
    }
}
