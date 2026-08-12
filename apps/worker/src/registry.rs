//! Hand-ported mirror of apps/daemon/src/registry.ts. Each agent's bespoke
//! quota/auth logic (apps/daemon/src/integrations/agents/*.ts) is not
//! ported — that's a separate, substantial body of work per provider. What's
//! here covers the whole catalog (shells, agents, IDEs, file explorers,
//! browsers): resolve a binary on PATH, list, detect version via the
//! `versionFlag` (no provider-specific version detection), and fire-and-
//! forget "open target" launches. Install/update/quota stay behind an
//! honest NOT_IMPLEMENTED in routes/registry.rs.

use crate::api_types::{OpenResult, RegistryActionResult, RegistryEntry, RegistryInstallState, RegistryKind, RegistryResponse};
use crate::host_registry::{HostEntryDef, HOST_BROWSERS, HOST_FILE_EXPLORERS, HOST_IDES};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::RwLock;

#[derive(Clone)]
struct RuntimeEntry {
    id: String,
    name: String,
    kind: RegistryKind,
    bin: Vec<String>,
    resolved_bin: Option<PathBuf>,
    enabled: bool,
    version_flag: Option<String>,
    install_command: Option<String>,
    website_url: Option<String>,
    missing_dependencies: Vec<String>,
}

fn to_public(entry: &RuntimeEntry) -> RegistryEntry {
    RegistryEntry {
        id: entry.id.clone(),
        name: entry.name.clone(),
        kind: entry.kind,
        enabled: entry.enabled,
        version: None,
        can_install: entry.install_command.is_some(),
        can_update: false,
        install_command: entry.install_command.clone(),
        website_url: entry.website_url.clone(),
        missing_dependencies: entry.missing_dependencies.clone(),
        install_state: RegistryInstallState::Idle,
        install_error: None,
    }
}

/// Expand `$LOCALAPPDATA` / `$PROGRAMFILES` / `$HOME` tokens the same way
/// apps/daemon/src/registry.ts's `expand()` does.
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
                version_flag: None,
                install_command: None,
                website_url: None,
                missing_dependencies: Vec::new(),
            }
        })
        .collect()
}

const SHELLS: &[(&str, &str, &[&str])] = &[
    ("bash", "Bash", &["bash"]),
    ("zsh", "Zsh", &["zsh"]),
    ("fish", "Fish", &["fish"]),
    ("nu", "Nushell", &["nu"]),
    ("pwsh", "PowerShell", &["pwsh", "powershell"]),
    ("cmd", "Command Prompt", &["cmd"]),
    ("sh", "sh", &["sh"]),
];

fn materialize_shells() -> Vec<RuntimeEntry> {
    SHELLS
        .iter()
        .map(|(id, name, bin)| {
            let bin: Vec<String> = bin.iter().map(|b| b.to_string()).collect();
            let resolved_bin = resolve_bin(&bin);
            RuntimeEntry {
                id: id.to_string(),
                name: name.to_string(),
                kind: RegistryKind::Shell,
                enabled: resolved_bin.is_some(),
                resolved_bin,
                bin,
                version_flag: None,
                install_command: None,
                website_url: None,
                missing_dependencies: Vec::new(),
            }
        })
        .collect()
}

fn materialize_agents() -> Vec<RuntimeEntry> {
    crate::agent_defs::AGENT_DEFS
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
                version_flag: (!def.version_flag.is_empty()).then(|| def.version_flag.to_string()),
                install_command: (!def.install_cmd.is_empty()).then(|| def.install_cmd.to_string()),
                website_url: (!def.website_url.is_empty()).then(|| def.website_url.to_string()),
                missing_dependencies,
            }
        })
        .collect()
}

pub struct RegistryService {
    entries: RwLock<HashMap<String, RuntimeEntry>>,
}

impl RegistryService {
    pub fn new() -> Self {
        Self { entries: RwLock::new(HashMap::new()) }
    }

    pub async fn init(&self) {
        let mut all = materialize_shells();
        all.extend(materialize_agents());
        all.extend(materialize(HOST_IDES, RegistryKind::Ide));
        all.extend(materialize(HOST_FILE_EXPLORERS, RegistryKind::FileExplorer));
        all.extend(materialize(HOST_BROWSERS, RegistryKind::Browser));

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
                    RegistryActionResult { ok: true, exit_code: 0, output: line }
                }
            }
            Err(error) => RegistryActionResult { ok: false, exit_code: 1, output: error.to_string() },
        }
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
