use super::support::{home_dir, summarize};
use super::AgentDef;
use crate::api_types::AgentConversationSummary;
use std::io::BufRead;

pub const DEF: AgentDef = AgentDef {
    id: "kimi",
    name: "Kimi Code",
    bin: &["kimi"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "powershell -NoProfile -Command \"irm https://code.kimi.com/kimi-code/install.ps1 | iex\"",
    update_cmd: "kimi upgrade",
    website_url: "https://code.kimi.com/",
    resume_args: &["--session", "{id}"],
};

/// `~/.kimi-code/session_index.jsonl` is a flat `{sessionId, sessionDir,
/// workDir}` index — the cleanest per-project lookup of any agent here, no
/// path-encoding to reverse. Each `sessionDir/state.json` has the title/times.
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let index_path = home.join(".kimi-code").join("session_index.jsonl");
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        let Ok(file) = std::fs::File::open(&index_path) else { return Vec::new() };
        let mut out = Vec::new();
        for line in std::io::BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if entry.get("workDir").and_then(|v| v.as_str()) != Some(project_path.as_str()) {
                continue;
            }
            let (Some(id), Some(session_dir)) =
                (entry.get("sessionId").and_then(|v| v.as_str()), entry.get("sessionDir").and_then(|v| v.as_str()))
            else {
                continue;
            };
            let Ok(state_raw) = std::fs::read_to_string(std::path::Path::new(session_dir).join("state.json")) else { continue };
            let Ok(state) = serde_json::from_str::<serde_json::Value>(&state_raw) else { continue };
            let title = state.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled session");
            let updated_at = state.get("updatedAt").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            out.push(AgentConversationSummary { id: id.to_string(), agent_ref_id: "kimi".to_string(), title: summarize(title, 80), preview: None, updated_at });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    })
    .await
    .unwrap_or_default()
}
