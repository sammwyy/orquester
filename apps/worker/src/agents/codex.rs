use super::support::{call, home_dir, summarize, unsupported_quota};
use super::AgentDef;
use crate::api_types::{AgentConversationSummary, QuotaPeriod, QuotaUnit, QuotaWindow, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota};
use std::io::BufRead;
use std::path::Path;

pub const DEF: AgentDef = AgentDef {
    id: "codex",
    name: "Codex",
    bin: &["codex"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "npm install -g @openai/codex",
    update_cmd: "npm update -g @openai/codex",
    website_url: "https://openai.com/codex/",
    // Subcommand, not a flag — codex's default (no args) launch is a distinct mode.
    resume_args: &["resume", "{id}"],
};

pub async fn auth_status(bin: &Path) -> RegistryAuthInfo {
    #[derive(serde::Deserialize)]
    struct AccountReadResult {
        account: Option<AccountInfo>,
    }
    #[derive(serde::Deserialize)]
    struct AccountInfo {
        email: Option<String>,
        #[serde(rename = "planType")]
        plan_type: Option<String>,
        #[serde(rename = "type")]
        kind: Option<String>,
    }

    if let Ok(value) = run_app_server_call(bin, "account/read", Some(serde_json::json!({ "refreshToken": false }))).await {
        if let Ok(result) = serde_json::from_value::<AccountReadResult>(value) {
            return match result.account {
                Some(account) => RegistryAuthInfo {
                    status: RegistryAuthStatus::Authenticated,
                    account: account.email,
                    message: account.plan_type.map(|t| format!("{t} plan")).or(account.kind),
                },
                None => RegistryAuthInfo { status: RegistryAuthStatus::Unauthenticated, account: None, message: None },
            };
        }
    }

    // Fall back to the CLI status command, same as the TS worker.
    let result = call(bin, &["login", "status"]).await;
    let output = result.output.to_lowercase();
    static AUTHED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static UNAUTHED: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let authed = AUTHED.get_or_init(|| regex::Regex::new(r"logged in|authenticated|api key").unwrap());
    let unauthed = UNAUTHED.get_or_init(|| regex::Regex::new(r"not logged in|not authenticated|no authentication|unauthorized").unwrap());
    if result.ok && authed.is_match(&output) {
        RegistryAuthInfo { status: RegistryAuthStatus::Authenticated, account: None, message: None }
    } else if unauthed.is_match(&output) {
        RegistryAuthInfo { status: RegistryAuthStatus::Unauthenticated, account: None, message: None }
    } else {
        RegistryAuthInfo {
            status: RegistryAuthStatus::Unknown,
            account: None,
            message: Some("Codex did not return a recognizable auth status.".to_string()),
        }
    }
}

pub async fn quota(bin: &Path, name: &str) -> RegistryQuota {
    #[derive(serde::Deserialize)]
    struct RateLimitsResult {
        #[serde(rename = "rateLimits")]
        rate_limits: Option<RateLimits>,
    }
    #[derive(serde::Deserialize)]
    struct RateLimits {
        primary: Option<CodexRateLimit>,
        secondary: Option<CodexRateLimit>,
    }
    #[derive(serde::Deserialize)]
    struct CodexRateLimit {
        #[serde(rename = "usedPercent")]
        used_percent: f64,
        #[serde(rename = "windowDurationMins")]
        window_duration_mins: i64,
        #[serde(rename = "resetsAt")]
        resets_at: Option<i64>,
    }

    let Ok(value) = run_app_server_call(bin, "account/rateLimits/read", None).await else {
        return unsupported_quota("codex", name, None);
    };
    let Ok(result) = serde_json::from_value::<RateLimitsResult>(value) else {
        return unsupported_quota("codex", name, None);
    };
    let limits = result.rate_limits.unwrap_or(RateLimits { primary: None, secondary: None });
    let windows: Vec<QuotaWindow> = [(0, limits.primary), (1, limits.secondary)]
        .into_iter()
        .filter_map(|(index, limit)| limit.map(|l| (index, l)))
        .map(|(index, limit)| QuotaWindow {
            id: if index == 0 { "primary".to_string() } else { "secondary".to_string() },
            label: codex_window_label(limit.window_duration_mins, index),
            period: codex_window_period(limit.window_duration_mins),
            unit: QuotaUnit::Unknown,
            limit: Some(100.0),
            used: Some(limit.used_percent),
            remaining: Some((100.0 - limit.used_percent).max(0.0)),
            percent_used: Some(limit.used_percent),
            resets_at: limit.resets_at.and_then(|secs| chrono::DateTime::from_timestamp(secs, 0)).map(|dt| dt.to_rfc3339()),
            reset_label: None,
        })
        .collect();

    if windows.is_empty() {
        return unsupported_quota("codex", name, None);
    }
    RegistryQuota {
        id: "codex".to_string(),
        provider: name.to_string(),
        auth: RegistryAuthInfo { status: RegistryAuthStatus::Unknown, account: None, message: None },
        supported: true,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        windows,
        message: None,
    }
}

/// `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — organized by date, not
/// project, so every file's first line (always `session_meta`, cheap to
/// check) has to be read to filter by `cwd`. The first real `response_item`
/// with `role:"user"` is usually preceded by injected boilerplate (AGENTS.md
/// contents, skill instructions) rather than what the human actually typed;
/// skipping oversized or obviously-labeled ones is a heuristic, not exact.
pub async fn list_conversations(project_path: &str) -> Vec<AgentConversationSummary> {
    let Some(home) = home_dir() else { return Vec::new() };
    let sessions_dir = home.join(".codex").join("sessions");
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for entry in ignore::WalkBuilder::new(&sessions_dir).hidden(false).build().flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(file) = std::fs::File::open(path) else { continue };
            let mut lines = std::io::BufReader::new(file).lines().map_while(Result::ok);
            let Some(first_line) = lines.next() else { continue };
            let Ok(meta) = serde_json::from_str::<serde_json::Value>(&first_line) else { continue };
            if meta.get("type").and_then(|t| t.as_str()) != Some("session_meta") {
                continue;
            }
            let payload = meta.get("payload").cloned().unwrap_or_default();
            if payload.get("cwd").and_then(|v| v.as_str()) != Some(project_path.as_str()) {
                continue;
            }
            let Some(id) = payload.get("session_id").and_then(|v| v.as_str()) else { continue };

            let title = lines.find_map(|line| {
                let value = serde_json::from_str::<serde_json::Value>(&line).ok()?;
                if value.get("type").and_then(|t| t.as_str()) != Some("response_item") {
                    return None;
                }
                let item = value.get("payload")?;
                if item.get("role").and_then(|v| v.as_str()) != Some("user") {
                    return None;
                }
                let text = extract_user_text(item)?;
                // Skip injected context (AGENTS.md, skills) and placeholder
                // tags like `<image name=...>` for pasted attachments.
                (text.len() <= 2000 && !text.starts_with('#') && !text.starts_with('<')).then(|| summarize(&text, 80))
            });

            let updated_at = std::fs::metadata(path)
                .and_then(|m| m.modified())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            out.push(AgentConversationSummary {
                id: id.to_string(),
                agent_ref_id: "codex".to_string(),
                title: title.unwrap_or_else(|| "Untitled session".to_string()),
                preview: None,
                updated_at,
            });
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out
    })
    .await
    .unwrap_or_default()
}

fn extract_user_text(item: &serde_json::Value) -> Option<String> {
    item.get("content")?.as_array()?.iter().find_map(|block| {
        (block.get("type").and_then(|t| t.as_str()) == Some("input_text")).then(|| block.get("text")?.as_str().map(str::to_string)).flatten()
    })
}

fn codex_window_period(minutes: i64) -> QuotaPeriod {
    if minutes <= 60 {
        QuotaPeriod::Hourly
    } else if minutes >= 10_000 {
        QuotaPeriod::Weekly
    } else {
        QuotaPeriod::Rolling
    }
}

fn codex_window_label(minutes: i64, index: usize) -> String {
    if minutes == 300 {
        "5-hour limit".to_string()
    } else if minutes >= 10_000 {
        "Weekly limit".to_string()
    } else if index == 0 {
        "Primary limit".to_string()
    } else {
        "Secondary limit".to_string()
    }
}

/// Speaks the app-server's newline-delimited JSON-RPC over stdio: spawn
/// `codex app-server --listen stdio://`, send `initialize`, wait briefly,
/// then send `initialized` followed by the real request, and return the
/// response matching id 2. Mirrors `runAppServerCall` in the TS worker.
async fn run_app_server_call(bin: &Path, method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let mut command = tokio::process::Command::new(bin);
    command.args(["app-server", "--listen", "stdio://"]);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    let work = async {
        stdin
            .write_all(
                format!(
                    "{}\n",
                    serde_json::json!({
                        "method": "initialize",
                        "id": 1,
                        "params": { "clientInfo": { "name": "orquester", "version": "0.0.0" }, "capabilities": { "experimentalApi": true } }
                    })
                )
                .as_bytes(),
            )
            .await
            .map_err(|e| e.to_string())?;

        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        stdin.write_all(format!("{}\n", serde_json::json!({ "method": "initialized" })).as_bytes()).await.map_err(|e| e.to_string())?;
        let mut request = serde_json::json!({ "method": method, "id": 2 });
        if let Some(params) = params {
            request["params"] = params;
        }
        stdin.write_all(format!("{}\n", request).as_bytes()).await.map_err(|e| e.to_string())?;

        loop {
            let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? else {
                return Err("app-server closed its output".to_string());
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            if message.get("id").and_then(|v| v.as_i64()) == Some(2) {
                if let Some(error) = message.get("error") {
                    return Err(format!("Codex app-server request failed: {error}"));
                }
                return Ok(message.get("result").cloned().unwrap_or(serde_json::Value::Null));
            }
        }
    };

    let result = tokio::time::timeout(std::time::Duration::from_secs(15), work).await;
    let _ = child.kill().await;
    match result {
        Ok(inner) => inner,
        Err(_) => Err("Codex app-server timed out.".to_string()),
    }
}
