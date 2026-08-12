//! Hand-ported mirror of apps/daemon/src/integrations/agents/*.ts's
//! getQuota/getAuthStatus logic (every agent's getVersion is just
//! `ctx.call(["--version"])` + first-line, already covered generically by
//! RegistryService::version — no per-agent override needed there).
//!
//! Ported: claude (auth status + usage text scraping, verified against a
//! real installed CLI), antigravity (usage text scraping, same shape as
//! claude), and the four agents whose TS integration is itself just a
//! literal `unsupportedQuota(...)` call (cline, deepcode, kimi, opencode).
//!
//! Not ported: codex (talks to `codex app-server` over a JSON-RPC-over-
//! stdio protocol) and grok (drives an interactive PTY session, waiting for
//! a regex stop-condition then sending Ctrl+C) — both need a request/
//! response subsystem this worker doesn't have yet, and neither CLI is
//! installed in this environment to verify against. They fall back to
//! `unsupported_quota`, which the UI already renders as "not supported"
//! rather than an error.

use crate::api_types::{
    QuotaPeriod, QuotaUnit, QuotaWindow, RegistryActionResult, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota,
};
use std::path::Path;

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

async fn call(bin: &Path, args: &[&str]) -> RegistryActionResult {
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

pub async fn get_auth_status(id: &str, bin: &Path) -> Option<RegistryAuthInfo> {
    match id {
        "claude" => Some(claude_auth_status(bin).await),
        // A readable antigravity usage response means the CLI has an active
        // session — see antigravity_quota, which sets this same status.
        _ => None,
    }
}

pub async fn get_quota(id: &str, bin: &Path, name: &str) -> RegistryQuota {
    match id {
        "claude" => claude_quota(bin, name).await,
        "antigravity" => antigravity_quota(bin, name).await,
        // Trivial in the TS worker too (agent-{cline,deepcode,kimi,opencode}.ts
        // all just return unsupportedQuota with these exact messages).
        "kimi" => unsupported_quota(id, name, Some("Kimi usage is not configured for this integration yet.")),
        "opencode" => unsupported_quota(id, name, Some("Quota is not supported by OpenCode yet.")),
        "cline" | "deepcode" => unsupported_quota(id, name, None),
        // codex (JSON-RPC app-server) and grok (interactive PTY + regex
        // stop-condition) need a request/response subsystem this worker
        // doesn't have yet — not ported, honestly unsupported rather than
        // faked.
        _ => unsupported_quota(id, name, None),
    }
}

async fn claude_auth_status(bin: &Path) -> RegistryAuthInfo {
    let result = call(bin, &["auth", "status"]).await;
    #[derive(serde::Deserialize)]
    struct ClaudeAuth {
        #[serde(rename = "loggedIn")]
        logged_in: Option<bool>,
        email: Option<String>,
        #[serde(rename = "subscriptionType")]
        subscription_type: Option<String>,
    }
    match serde_json::from_str::<ClaudeAuth>(&result.output) {
        Ok(data) if data.logged_in == Some(true) => RegistryAuthInfo {
            status: RegistryAuthStatus::Authenticated,
            account: data.email,
            message: data.subscription_type.map(|t| format!("{t} subscription")),
        },
        Ok(_) => RegistryAuthInfo { status: RegistryAuthStatus::Unauthenticated, account: None, message: None },
        Err(_) if result.ok => RegistryAuthInfo {
            status: RegistryAuthStatus::Unknown,
            account: None,
            message: Some("Claude returned an unrecognized auth response.".to_string()),
        },
        Err(_) => RegistryAuthInfo { status: RegistryAuthStatus::Unauthenticated, account: None, message: None },
    }
}

async fn claude_quota(bin: &Path, name: &str) -> RegistryQuota {
    let result = call(bin, &["--print", "/usage"]).await;
    if !result.ok {
        return unsupported_quota("claude", name, None);
    }
    let windows = parse_claude_usage(&result.output);
    if windows.is_empty() {
        return unsupported_quota("claude", name, None);
    }
    RegistryQuota {
        id: "claude".to_string(),
        provider: name.to_string(),
        auth: RegistryAuthInfo { status: RegistryAuthStatus::Unknown, account: None, message: None },
        supported: true,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        windows,
        message: None,
    }
}

fn parse_claude_usage(output: &str) -> Vec<QuotaWindow> {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(r"(?i)^\s*(Current session|Current week(?:\s+\([^)]*\))?)\s*:\s*(\d+(?:\.\d+)?)%\s+used\s*[·-]\s*resets?\s+(.+)$").unwrap()
    });
    let mut windows = Vec::new();
    for line in output.lines() {
        let Some(captures) = pattern.captures(line) else { continue };
        let label_raw = &captures[1];
        let used: f64 = captures[2].parse().unwrap_or(0.0);
        let reset_text = captures[3].trim().to_string();
        let is_week = label_raw.to_lowercase().starts_with("current week");
        windows.push(QuotaWindow {
            id: if is_week { "weekly".to_string() } else { "session".to_string() },
            label: if is_week { "Current week".to_string() } else { "Current session".to_string() },
            period: if is_week { QuotaPeriod::Weekly } else { QuotaPeriod::Rolling },
            unit: QuotaUnit::Unknown,
            limit: Some(100.0),
            used: Some(used),
            remaining: Some((100.0 - used).max(0.0)),
            percent_used: Some(used),
            resets_at: normalize_claude_reset(&reset_text),
            reset_label: Some(reset_text),
        });
    }
    windows
}

async fn antigravity_quota(bin: &Path, name: &str) -> RegistryQuota {
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

/// Parses a reset string like "Aug 15, 3:00pm (America/New_York)" into an
/// RFC3339 instant. Mirrors `normalizeClaudeReset`'s two-pass DST correction
/// in the TS worker, but does it in one step using chrono-tz's real IANA
/// timezone database instead of round-tripping through Intl.DateTimeFormat.
fn normalize_claude_reset(value: &str) -> Option<String> {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN
        .get_or_init(|| regex::Regex::new(r"(?i)^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)$").unwrap());
    let captures = pattern.captures(value.trim())?;

    let month_str = captures[1].to_lowercase();
    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let month = months.iter().position(|m| *m == month_str)? as u32 + 1;
    let day: u32 = captures[2].parse().ok()?;
    let mut hour: u32 = captures[3].parse().ok()?;
    let minute: u32 = captures.get(4).map(|m| m.as_str()).unwrap_or("0").parse().ok()?;
    let is_pm = captures[5].eq_ignore_ascii_case("pm");
    if is_pm && hour != 12 {
        hour += 12;
    } else if !is_pm && hour == 12 {
        hour = 0;
    }
    let tz_name = &captures[6];
    let tz: chrono_tz::Tz = tz_name.parse().ok()?;

    let now = chrono::Utc::now();
    let year = now.year_in(&tz);
    let naive = chrono::NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(hour, minute, 0)?;
    let local = tz.from_local_datetime(&naive).single()?;
    Some(local.to_utc().to_rfc3339())
}

use chrono::TimeZone;

trait YearInTz {
    fn year_in(&self, tz: &chrono_tz::Tz) -> i32;
}

impl YearInTz for chrono::DateTime<chrono::Utc> {
    fn year_in(&self, tz: &chrono_tz::Tz) -> i32 {
        use chrono::Datelike;
        self.with_timezone(tz).year()
    }
}
