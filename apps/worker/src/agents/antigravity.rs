use super::support::{call, unsupported_quota};
use super::AgentDef;
use crate::api_types::{QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use std::path::Path;

pub const DEF: AgentDef = AgentDef {
    id: "antigravity",
    name: "Antigravity",
    bin: &["agy"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "powershell -NoProfile -Command \"irm https://antigravity.google/cli/install.ps1 | iex\"",
    update_cmd: "agy update",
    website_url: "https://antigravity.google/",
};

pub async fn quota(bin: &Path, name: &str) -> RegistryQuota {
    let result = call(bin, &["-p", "/usage"]).await;
    if !result.ok {
        return unsupported_quota("antigravity", name, None);
    }
    let windows = parse_antigravity_usage(&result.output);
    if windows.is_empty() {
        return unsupported_quota("antigravity", name, Some("Antigravity did not return a recognizable usage response."));
    }
    RegistryQuota {
        id: "antigravity".to_string(),
        provider: name.to_string(),
        // A readable usage response means the CLI has an active session.
        auth: RegistryAuthInfo { status: RegistryAuthStatus::Authenticated, account: None, message: None },
        supported: true,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        windows,
        message: None,
    }
}

fn parse_antigravity_usage(output: &str) -> Vec<QuotaWindow> {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(r"(?i)^\s*(Gemini Models|Claude and GPT models)\s+(Weekly Limit|Five Hour Limit)\s+Remaining\s+(\d+(?:\.\d+)?)%\s+(\S+)\s*$").unwrap()
    });
    let mut windows = Vec::new();
    for line in output.lines() {
        let Some(captures) = pattern.captures(line) else { continue };
        let group = &captures[1];
        let is_five_hour = captures[2].to_lowercase().starts_with("five hour");
        let remaining: f64 = captures[3].parse().unwrap_or(0.0);
        let reset = captures[4].to_string();
        let slug = group.to_lowercase().replace(' ', "-");
        windows.push(QuotaWindow {
            id: format!("{slug}-{}", if is_five_hour { "five-hour" } else { "weekly" }),
            label: format!("{group} · {}", if is_five_hour { "Five hour" } else { "Weekly" }),
            period: if is_five_hour { QuotaPeriod::Rolling } else { QuotaPeriod::Weekly },
            unit: QuotaUnit::Unknown,
            limit: Some(100.0),
            used: Some((100.0 - remaining).max(0.0)),
            remaining: Some(remaining),
            percent_used: Some((100.0 - remaining).max(0.0)),
            resets_at: Some(reset.clone()),
            reset_label: Some(reset),
        });
    }
    windows
}
