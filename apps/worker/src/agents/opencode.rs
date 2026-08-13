use super::support::{home_dir, summarize};
use super::AgentDef;
use crate::api_types::AgentConversationSummary;

pub const DEF: AgentDef = AgentDef {
    id: "opencode",
    name: "OpenCode",
    bin: &["opencode"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "npm install -g opencode-ai",
    update_cmd: "npm update -g opencode-ai",
    website_url: "https://opencode.ai/",
    resume_args: &["--session", "{id}"],
};

/// `~/.local/share/opencode/opencode.db` (XDG data dir, not `~/.opencode` —
/// that's just the installed binary) — a real relational schema, easiest of
/// any agent here to query. `time_updated` is epoch milliseconds.
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let db_path = home.join(".local").join("share").join("opencode").join("opencode.db");
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return Vec::new() };
        let Ok(mut stmt) =
            conn.prepare("SELECT id, title, time_updated FROM session WHERE directory = ?1 AND time_archived IS NULL ORDER BY time_updated DESC")
        else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([&project_path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))) else {
            return Vec::new();
        };
        rows.flatten()
            .map(|(id, title, updated_ms)| AgentConversationSummary {
                id,
                agent_ref_id: "opencode".to_string(),
                title: summarize(&title, 80),
                preview: None,
                updated_at: chrono::DateTime::from_timestamp_millis(updated_ms).map(|dt| dt.to_rfc3339()).unwrap_or_default(),
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}
