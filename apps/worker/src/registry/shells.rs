use super::{resolve_bin, RuntimeEntry};
use crate::api_types::{RegistryInstallState, RegistryKind};

pub const SHELLS: &[(&str, &str, &[&str])] = &[
    ("bash", "Bash", &["bash"]),
    ("zsh", "Zsh", &["zsh"]),
    ("fish", "Fish", &["fish"]),
    ("nu", "Nushell", &["nu"]),
    ("pwsh", "PowerShell", &["pwsh", "powershell"]),
    ("cmd", "Command Prompt", &["cmd"]),
    ("sh", "sh", &["sh"]),
];

pub fn materialize_shells() -> Vec<RuntimeEntry> {
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
