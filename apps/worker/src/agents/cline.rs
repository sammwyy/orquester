use super::support::{home_dir, summarize};
use super::AgentDef;
use crate::api_types::AgentConversationSummary;

pub const DEF: AgentDef = AgentDef {
    id: "cline",
    name: "Cline",
    bin: &["cline"],
    bin_deps: &["npm"],
    version_flag: "--version",
    install_cmd: "npm i -g cline",
    update_cmd: "npm i -g cline",
    website_url: "https://cline.bot/",
    resume_args: &["--id", "{id}"],
};

/// `~/.cline/data/db/sessions.db` — `prompt` gives the first user message
/// directly in the index row (wrapped in a `<user_input>` tag to strip), no
/// need to open the separate transcript file just to list sessions.
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let db_path = home.join(".cline").join("data").join("db").join("sessions.db");
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        let Ok(conn) = rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return Vec::new() };
        let Ok(mut stmt) =
            conn.prepare("SELECT session_id, prompt, updated_at FROM sessions WHERE cwd = ?1 OR workspace_root = ?1 ORDER BY updated_at DESC")
        else {
            return Vec::new();
        };
        let Ok(rows) =
            stmt.query_map([&project_path], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?)))
        else {
            return Vec::new();
        };
        rows.flatten()
            .map(|(id, prompt, updated_at)| {
                let title = prompt.as_deref().map(strip_user_input_tag).filter(|s| !s.is_empty()).unwrap_or_else(|| "Untitled session".to_string());
                AgentConversationSummary { id, agent_ref_id: "cline".to_string(), title: summarize(&title, 80), preview: None, updated_at }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn strip_user_input_tag(text: &str) -> String {
    static TAG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = TAG.get_or_init(|| regex::Regex::new(r"</?user_input[^>]*>").unwrap());
    re.replace_all(text, "").trim().to_string()
}
