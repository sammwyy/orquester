use super::support::{call, home_dir, summarize, unsupported_quota};
use super::AgentDef;
use crate::api_types::{AgentConversationSummary, QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use chrono::{Datelike, TimeZone};
use std::io::BufRead;
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
    resume_args: &["--resume", "{id}"],
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

/// One `.jsonl` transcript per session under `~/.claude/projects/<slug>/`,
/// where `<slug>` is the project's absolute path with every `/` replaced by
/// `-`. Title prefers the CLI's own auto-generated `slug` field (present on
/// newer versions) over the raw first user message; `updated_at` is the
/// file's mtime since no explicit "last activity" field exists in the format.
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let slug = project_path.replace(['/', '\\'], "-");
    let dir = home.join(".claude").join("projects").join(slug);
    tokio::task::spawn_blocking(move || {
        let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
        let mut out = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            let Some((title, created_at)) = first_user_message(&path) else { continue };
            let updated_at = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                .unwrap_or(created_at);
            out.push(AgentConversationSummary { id: id.to_string(), agent_ref_id: "claude".to_string(), title, preview: None, updated_at });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    })
    .await
    .unwrap_or_default()
}

/// Scans up to 40 lines rather than stopping at the first `type:"user"`
/// line: Claude Code sometimes wraps slash-command output in a
/// `<local-command-caveat>` line ahead of the real first message, and
/// `slug` (a nicer auto-title) doesn't always land on the very first line
/// either. `slug` wins wherever it's found; otherwise the first message
/// that isn't an injected wrapper.
fn first_user_message(path: &std::path::Path) -> Option<(String, String)> {
    let file = std::fs::File::open(path).ok()?;
    let mut fallback_created_at: Option<String> = None;
    let mut clean_text: Option<(String, String)> = None;
    for line in std::io::BufReader::new(file).lines().take(40).map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if value.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let created_at = value.get("timestamp").and_then(|t| t.as_str()).unwrap_or_default().to_string();
        fallback_created_at.get_or_insert_with(|| created_at.clone());
        if let Some(slug) = value.get("slug").and_then(|s| s.as_str()) {
            return Some((slug.replace('-', " "), created_at));
        }
        if clean_text.is_some() {
            continue;
        }
        let Some(content) = value.pointer("/message/content") else { continue };
        let Some(text) = content
            .as_str()
            .map(str::to_string)
            .or_else(|| content.as_array()?.iter().find_map(|block| block.get("text")?.as_str().map(str::to_string)))
        else {
            continue;
        };
        if is_injected_wrapper(&text) {
            continue;
        }
        clean_text = Some((summarize(&text, 80), created_at));
    }
    clean_text.or_else(|| fallback_created_at.map(|ts| ("Untitled session".to_string(), ts)))
}

fn is_injected_wrapper(text: &str) -> bool {
    text.starts_with('<') || text.len() > 4000
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
