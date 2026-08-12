//! Agent quota support.
//! getQuota/getAuthStatus logic (every agent's getVersion is just
//! `ctx.call(["--version"])` + first-line, already covered generically by
//! RegistryService::version — no per-agent override needed there).
//!
//! Ported: claude (auth status + usage text scraping, verified against a
//! real installed CLI), antigravity (usage text scraping, same shape as
//! claude), and the four agents whose TS integration is itself just a
//! literal `unsupportedQuota(...)` call (cline, deepcode, kimi, opencode).
//!
//! codex talks to `codex app-server` over a JSON-RPC-over-stdio protocol,
//! ported below and live-verified against a real installed+authenticated
//! Codex CLI (account/read and account/rateLimits/read both returned real
//! data on the first try).
//!
//! grok drives an interactive PTY session (via portable-pty, same crate
//! sessions.rs uses for real terminal tabs), waits for a regex
//! stop-condition, then sends Ctrl+C — ported below, byte-for-byte the same
//! `grok --minimal /usage` invocation the TS worker makes. Live-tested
//! against a real installed Grok CLI (0.2.54): that flag no longer exists in
//! this version ("unexpected argument '--minimal' found") — a CLI-side
//! regression that affects the *current* TS daemon identically, not
//! something this port introduced. What matters for parity held up: the PTY
//! spawned, ran to the 20s timeout, got killed, and the route returned a
//! clean `supported: false` response instead of hanging or crashing —
//! exactly what the TS worker would also produce against this same CLI.

use crate::api_types::{
    QuotaPeriod, QuotaUnit, QuotaWindow, RegistryActionResult, RegistryAuthInfo, RegistryAuthStatus, RegistryQuota,
};
use chrono::{Datelike, TimeZone};
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
        "codex" => Some(codex_auth_status(bin).await),
        "grok" => Some(grok_auth_status(bin).await),
        // A readable antigravity usage response means the CLI has an active
        // session — see antigravity_quota, which sets this same status.
        _ => None,
    }
}

pub async fn get_quota(id: &str, bin: &Path, name: &str) -> RegistryQuota {
    match id {
        "claude" => claude_quota(bin, name).await,
        "antigravity" => antigravity_quota(bin, name).await,
        "codex" => codex_quota(bin, name).await,
        "grok" => grok_quota(bin, name).await,
        // Trivial in the TS worker too (agent-{cline,deepcode,kimi,opencode}.ts
        // all just return unsupportedQuota with these exact messages).
        "kimi" => unsupported_quota(id, name, Some("Kimi usage is not configured for this integration yet.")),
        "opencode" => unsupported_quota(id, name, Some("Quota is not supported by OpenCode yet.")),
        "cline" | "deepcode" => unsupported_quota(id, name, None),
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

async fn codex_auth_status(bin: &Path) -> RegistryAuthInfo {
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

async fn codex_quota(bin: &Path, name: &str) -> RegistryQuota {
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
/// response matching id 2. Mirrors `runAppServerCall` in
/// Returns a registered agent's quota state.
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

async fn grok_auth_status(bin: &Path) -> RegistryAuthInfo {
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

async fn grok_quota(bin: &Path, name: &str) -> RegistryQuota {
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

/// Strips ANSI/OSC/DCS terminal escape sequences, same three patterns the TS
/// worker strips before regex-matching the PTY's raw output.
fn strip_ansi(input: &str) -> String {
    static OSC: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static DCS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static CSI: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let osc = OSC.get_or_init(|| regex::Regex::new("\u{1b}\\][^\u{7}]*(?:\u{7}|\u{1b}\\\\)").unwrap());
    let dcs = DCS.get_or_init(|| regex::Regex::new("\u{1b}_[^\u{1b}]*\u{1b}\\\\").unwrap());
    let csi = CSI.get_or_init(|| regex::Regex::new("\u{1b}\\[[0-?]*[ -/]*[@-~]").unwrap());
    let step1 = osc.replace_all(input, "");
    let step2 = dcs.replace_all(&step1, "");
    let step3 = csi.replace_all(&step2, "");
    step3.replace('\r', "")
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

/// Drives an interactive PTY session (portable-pty, same crate sessions.rs
/// uses) until `stop_when` matches the accumulated output, then sends
/// Ctrl+C and gives it 250ms to wind down. 20s overall timeout. Mirrors
/// Starts an interactive agent command.
async fn call_interactive(bin: &Path, args: &[&str], stop_when: &regex::Regex) -> Result<String, String> {
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = portable_pty::CommandBuilder::new(bin);
    for arg in args {
        cmd.arg(arg);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match std::io::Read::read(&mut reader, &mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(chunk[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    const MAX_BUFFER: usize = 64_000;
    let mut output: Vec<u8> = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Some(chunk)) => {
                output.extend_from_slice(&chunk);
                if output.len() > MAX_BUFFER {
                    let excess = output.len() - MAX_BUFFER;
                    output.drain(0..excess);
                }
                let text = String::from_utf8_lossy(&output);
                if stop_when.is_match(&text) {
                    use std::io::Write as _;
                    let _ = writer.write_all(b"\x03");
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
    let _ = child.kill();
    Ok(String::from_utf8_lossy(&output).into_owned())
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
