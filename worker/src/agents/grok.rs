use super::support::{call, call_interactive, home_dir, strip_ansi, summarize, unsupported_quota};
use super::AgentDef;
use crate::api_types::{AgentConversationSummary, QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use chrono::TimeZone;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use std::path::Path;

pub const DEF: AgentDef = AgentDef {
    id: "grok",
    name: "Grok Build",
    bin: &["grok"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
    update_cmd: "grok update",
    website_url: "https://x.ai/",
    resume_args: &["--resume", "{id}"],
};

pub async fn auth_status(bin: &Path) -> RegistryAuthInfo {
    let result = call(bin, &["models"]).await;
    let output_lower = result.output.to_lowercase();
    static AUTHED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static UNAUTHED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static MODEL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let authed = AUTHED.get_or_init(|| regex::Regex::new(r"logged in with grok\.com|logged in").unwrap());
    let unauthed = UNAUTHED.get_or_init(|| regex::Regex::new(r"not logged in|login required|unauthenticated").unwrap());
    let model_pattern = MODEL.get_or_init(|| regex::Regex::new(r"(?i)Default model:\s*(.+)").unwrap());

    if result.ok && authed.is_match(&output_lower) {
        let model = model_pattern.captures(&result.output).map(|c| c[1].trim().to_string());
        return RegistryAuthInfo {
            status: RegistryAuthStatus::Authenticated,
            account: Some("grok.com".to_string()),
            message: model.map(|m| format!("default {m}")),
        };
    }
    if unauthed.is_match(&output_lower) {
        return RegistryAuthInfo { status: RegistryAuthStatus::Unauthenticated, account: None, message: None };
    }
    RegistryAuthInfo {
        status: RegistryAuthStatus::Unknown,
        account: None,
        message: Some("Grok did not return a recognizable auth status.".to_string()),
    }
}

pub async fn quota(bin: &Path, name: &str) -> RegistryQuota {
    static STOP: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let stop = STOP.get_or_init(|| regex::Regex::new(r"(?i)(?:Current week.*resets|Next reset)").unwrap());

    let Ok(output) = call_interactive(bin, &["--minimal", "/usage"], stop).await else {
        return unsupported_quota("grok", name, Some("Grok usage requires an interactive terminal."));
    };
    let windows = parse_grok_usage(&output);
    if windows.is_empty() {
        return unsupported_quota("grok", name, Some("Grok did not return a recognizable usage response."));
    }
    RegistryQuota {
        id: "grok".to_string(),
        provider: name.to_string(),
        auth: RegistryAuthInfo { status: RegistryAuthStatus::Unknown, account: None, message: None },
        supported: true,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        windows,
        message: None,
    }
}

/// `~/.grok/sessions/<percent-encoded absolute path>/<session-uuid>/summary.json`
/// — richest metadata of any agent here (auto-generated title, both
/// created/updated timestamps), so this is a near-direct field mapping.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~').remove(b'!').remove(b'*').remove(b'\'').remove(b'(').remove(b')');

pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let encoded = utf8_percent_encode(project_path, COMPONENT).to_string();
    let dir = home.join(".grok").join("sessions").join(encoded);
    tokio::task::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let summary_path = entry.path().join("summary.json");
            let Ok(content) = std::fs::read_to_string(&summary_path) else { continue };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else { continue };
            let Some(id) = value.pointer("/info/id").and_then(|v| v.as_str()) else { continue };
            let title = value
                .get("generated_title")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| value.get("session_summary").and_then(|v| v.as_str()).filter(|s| !s.is_empty()))
                .unwrap_or("Untitled session");
            let updated_at =
                value.get("last_active_at").or_else(|| value.get("updated_at")).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            out.push(AgentConversationSummary { id: id.to_string(), agent_ref_id: "grok".to_string(), title: summarize(title, 80), preview: None, updated_at });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    })
    .await
    .unwrap_or_default()
}

fn parse_grok_usage(output: &str) -> Vec<QuotaWindow> {
    let clean = strip_ansi(output);
    static RESET: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static CURRENT: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static WEEKLY: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let reset_pattern = RESET.get_or_init(|| regex::Regex::new(r"(?i)Next reset:\s*([A-Za-z]+\s+\d{1,2},\s+\d{1,2}:\d{2})").unwrap());
    let current_pattern = CURRENT
        .get_or_init(|| regex::Regex::new(r"(?i)Current week(?:\s*\([^)]*\))?\s*:\s*(\d+(?:\.\d+)?)%\s+used\s*[·-]\s*resets?\s+(.+)").unwrap());
    let weekly_pattern = WEEKLY.get_or_init(|| regex::Regex::new(r"(?i)Weekly limit:\s*(\d+(?:\.\d+)?)%").unwrap());

    let mut windows: Vec<QuotaWindow> = Vec::new();
    let mut pending_reset: Option<String> = None;
    for line in clean.split('\n') {
        let reset = reset_pattern.captures(line).map(|c| c[1].trim().to_string());

        // "Current week: N% used - resets <label>" carries its own reset
        // label; a bare "Weekly limit: N%" doesn't, so it falls back to a
        // reset line seen on the same or an earlier line.
        let (used, reset_label) = if let Some(captures) = current_pattern.captures(line) {
            let used: f64 = captures[1].parse().unwrap_or(0.0);
            let label = captures.get(2).map(|m| m.as_str().trim().to_string());
            (Some(used), label)
        } else if let Some(captures) = weekly_pattern.captures(line) {
            let used: f64 = captures[1].parse().unwrap_or(0.0);
            (Some(used), reset.clone().or_else(|| pending_reset.clone()))
        } else {
            (None, None)
        };

        if let Some(used) = used {
            windows.push(QuotaWindow {
                id: "weekly".to_string(),
                label: "Weekly".to_string(),
                period: QuotaPeriod::Weekly,
                unit: QuotaUnit::Unknown,
                limit: Some(100.0),
                used: Some(used),
                remaining: Some((100.0 - used).max(0.0)),
                percent_used: Some(used),
                resets_at: reset_label.as_deref().and_then(normalize_grok_reset),
                reset_label,
            });
            pending_reset = None;
            continue;
        }

        if let Some(reset) = reset {
            if let Some(last) = windows.last_mut() {
                if last.reset_label.is_none() {
                    last.resets_at = normalize_grok_reset(&reset);
                    last.reset_label = Some(reset.clone());
                }
            }
            pending_reset = Some(reset);
        }
    }
    windows
}

fn normalize_grok_reset(value: &str) -> Option<String> {
    use chrono::Datelike;
    let with_year = format!("{value} {}", chrono::Utc::now().year());
    // Grok's "Mon D, H:MM" has no explicit timezone; treat it as this
    // worker's local time, matching the TS worker's bare `Date.parse`.
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| regex::Regex::new(r"(?i)^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s+(\d{4})$").unwrap());
    let captures = pattern.captures(&with_year)?;
    let months = [
        "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    ];
    let month_name = captures[1].to_lowercase();
    let month = months.iter().position(|m| *m == month_name)? as u32 + 1;
    let day: u32 = captures[2].parse().ok()?;
    let hour: u32 = captures[3].parse().ok()?;
    let minute: u32 = captures[4].parse().ok()?;
    let year: i32 = captures[5].parse().ok()?;
    let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(hour, minute, 0)?;
    let local = chrono::Local.from_local_datetime(&naive).single()?;
    Some(local.to_utc().to_rfc3339())
}
