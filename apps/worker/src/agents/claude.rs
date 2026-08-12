use super::support::{call, unsupported_quota};
use super::AgentDef;
use crate::api_types::{QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use chrono::{Datelike, TimeZone};
use std::path::Path;

pub const DEF: AgentDef = AgentDef {
    id: "claude",
    name: "Claude Code",
    bin: &["claude"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "npm install -g @anthropic-ai/claude-code",
    update_cmd: "npm update -g @anthropic-ai/claude-code",
    website_url: "https://www.anthropic.com/claude-code",
};

pub async fn auth_status(bin: &Path) -> RegistryAuthInfo {
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

pub async fn quota(bin: &Path, name: &str) -> RegistryQuota {
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

trait YearInTz {
    fn year_in(&self, tz: &chrono_tz::Tz) -> i32;
}

impl YearInTz for chrono::DateTime<chrono::Utc> {
    fn year_in(&self, tz: &chrono_tz::Tz) -> i32 {
        self.with_timezone(tz).year()
    }
}
