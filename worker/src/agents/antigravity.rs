use super::support::{call, home_dir, summarize, unsupported_quota};
use super::AgentDef;
use crate::api_types::{AgentConversationSummary, QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
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
    resume_args: &["--conversation", "{id}"],
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

/// `~/.gemini/antigravity-cli/conversation_summaries.db` — NOT `~/.antigravity`
/// (that's the bundled VS Code-fork IDE's unrelated data). `workspace_uris`
/// is a JSON array of `file://` URIs; matched with LIKE rather than parsed,
/// since a substring match on a `file://<abs-path>` needle is unambiguous
/// here. Full transcripts are partly protobuf and out of scope — this is
/// list-only. `last_modified_time` needs its own parse (space-separated,
/// nanosecond precision, not quite RFC3339).
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let db_path = home.join(".gemini").join("antigravity-cli").join("conversation_summaries.db");
    let needle = format!("file://{project_path}");
    tokio::task::spawn_blocking(move || {
        let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return Vec::new() };
        let Ok(mut stmt) = conn.prepare(
            "SELECT conversation_id, title, preview, last_modified_time FROM conversation_summaries WHERE workspace_uris LIKE '%' || ?1 || '%' ORDER BY last_modified_time DESC",
        ) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([&needle], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?))
        }) else {
            return Vec::new();
        };
        rows.flatten()
            .map(|(id, title, preview, raw_time)| {
                let display = if !title.is_empty() { title } else if !preview.is_empty() { preview } else { "Untitled conversation".to_string() };
                let updated_at = parse_antigravity_time(&raw_time).unwrap_or(raw_time);
                AgentConversationSummary { id, agent_ref_id: "antigravity".to_string(), title: summarize(&display, 80), preview: None, updated_at }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn parse_antigravity_time(raw: &str) -> Option<String> {
    chrono::DateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.f%:z").ok().map(|dt| dt.to_rfc3339())
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
