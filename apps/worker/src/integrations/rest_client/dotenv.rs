//! Reads `{{env_NAME}}` values straight from the project's own `.env` —
//! resolved worker-side only, same as the stored-variable store, so a value
//! already kept out of the repo via `.env` never round-trips through a client.

use std::collections::HashMap;

/// `NAME -> value` from `<project_path>/.env`; empty (never an error) if there isn't one.
pub async fn load(project_path: &str) -> HashMap<String, String> {
    let content = tokio::fs::read_to_string(format!("{project_path}/.env")).await.unwrap_or_default();
    parse(&content)
}

fn parse(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let value = value.trim();
        let value = if value.len() >= 2 && ((value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\''))) {
            &value[1..value.len() - 1]
        } else {
            value
        };
        map.insert(key.to_string(), value.to_string());
    }
    map
}
