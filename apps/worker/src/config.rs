//! Hand-ported mirror of packages/config/src/index.ts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const ORQUESTER_DIR_NAME: &str = ".orquester";
pub const DEFAULT_HTTP_HOST: &str = "127.0.0.1";
pub const DEFAULT_HTTP_PORT: u16 = 47831;
pub const LOCAL_CONNECTION_ID: &str = "local";

/// POSIX-style join used for config locations (keeps `/` separators).
pub fn join_path(segments: &[&str]) -> String {
    let filtered: Vec<&str> = segments.iter().copied().filter(|s| !s.is_empty()).collect();
    if filtered.is_empty() {
        return String::new();
    }
    let mut parts = Vec::with_capacity(filtered.len());
    parts.push(filtered[0].trim_end_matches(['\\', '/']).to_string());
    for segment in &filtered[1..] {
        let trimmed = segment.trim_start_matches(['\\', '/']).trim_end_matches(['\\', '/']);
        parts.push(trimmed.to_string());
    }
    parts.join("/")
}

#[derive(Debug, Clone)]
pub struct ConfigVars {
    pub user: String,
    pub userhome: String,
    pub cwd: String,
    pub appdir: String,
}

/// Replace `$userhome`/`$user`/`$cwd`/`$appdir` in a string.
pub fn expand_vars(value: &str, vars: &ConfigVars) -> String {
    value
        .replace("$userhome", &vars.userhome)
        .replace("$appdir", &vars.appdir)
        .replace("$cwd", &vars.cwd)
        .replace("$user", &vars.user)
}

pub fn resolve_base_dir(home_dir: &str, appdir: Option<&str>) -> String {
    match appdir {
        Some(dir) if !dir.is_empty() => dir.to_string(),
        _ => join_path(&[home_dir, ORQUESTER_DIR_NAME]),
    }
}

pub fn app_config_dir(base_dir: &str) -> String {
    join_path(&[base_dir, "app"])
}

pub fn daemon_config_dir(base_dir: &str) -> String {
    join_path(&[base_dir, "daemon"])
}

pub fn app_config_path(base_dir: &str) -> String {
    join_path(&[&app_config_dir(base_dir), "app.json"])
}

pub fn remotes_config_path(base_dir: &str) -> String {
    join_path(&[&app_config_dir(base_dir), "remotes.json"])
}

pub fn daemon_config_path(base_dir: &str) -> String {
    join_path(&[&daemon_config_dir(base_dir), "daemon.json"])
}

pub fn default_socket_path(base_dir: &str, platform: &str) -> String {
    if platform == "win32" {
        return "\\\\.\\pipe\\orquester-daemon".to_string();
    }
    join_path(&[&daemon_config_dir(base_dir), "daemon.sock"])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpTransportConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    /// Transient plaintext input (env / settings). Migrated to `password_hash`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub serve_web: bool,
    /// bcrypt hash of the password — what's persisted at rest.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
}

impl Default for HttpTransportConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: DEFAULT_HTTP_HOST.to_string(),
            port: DEFAULT_HTTP_PORT,
            password: None,
            username: None,
            serve_web: false,
            password_hash: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TransportsConfig {
    pub http: HttpTransportConfig,
}

impl Default for TransportsConfig {
    fn default() -> Self {
        Self { http: HttpTransportConfig::default() }
    }
}

fn default_integrations() -> HashMap<String, bool> {
    [
        ("git", true),
        ("battery", true),
        ("system-resources", true),
        ("media", true),
        ("keep-awake", false),
        ("networking", true),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DaemonConfig {
    pub version: u32,
    pub quota_workers: HashMap<String, bool>,
    pub integrations: HashMap<String, bool>,
    /// May contain $vars; expand with expand_vars() before use.
    pub workspaces_dir: String,
    pub logs_dir: String,
    pub transports: TransportsConfig,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            version: 1,
            quota_workers: HashMap::new(),
            integrations: default_integrations(),
            workspaces_dir: "$userhome/workspaces".to_string(),
            logs_dir: "$appdir/daemon/logs".to_string(),
            transports: TransportsConfig::default(),
        }
    }
}

pub struct DaemonPaths {
    pub base_dir: String,
    pub daemon_dir: String,
    pub config_path: String,
    pub socket_path: String,
    pub vars: ConfigVars,
}

pub struct ResolveDaemonPathsInput<'a> {
    pub home_dir: &'a str,
    pub platform: &'a str,
    pub cwd: &'a str,
    pub appdir: Option<&'a str>,
    pub env: &'a HashMap<String, String>,
}

pub fn resolve_daemon_paths(input: ResolveDaemonPathsInput) -> DaemonPaths {
    let base_dir = resolve_base_dir(input.home_dir, input.appdir);
    let user = input
        .env
        .get("USER")
        .or_else(|| input.env.get("USERNAME"))
        .cloned()
        .unwrap_or_else(|| last_segment(input.home_dir));

    DaemonPaths {
        daemon_dir: daemon_config_dir(&base_dir),
        config_path: input
            .env
            .get("ORQUESTER_DAEMON_CONFIG")
            .cloned()
            .unwrap_or_else(|| daemon_config_path(&base_dir)),
        socket_path: input
            .env
            .get("ORQUESTER_UNIX_SOCKET")
            .cloned()
            .unwrap_or_else(|| default_socket_path(&base_dir, input.platform)),
        vars: ConfigVars {
            user,
            userhome: input.home_dir.to_string(),
            cwd: input.cwd.to_string(),
            appdir: base_dir.clone(),
        },
        base_dir,
    }
}

fn last_segment(path: &str) -> String {
    path.split(['\\', '/']).filter(|s| !s.is_empty()).last().unwrap_or("").to_string()
}

pub fn create_default_daemon_config(env: &HashMap<String, String>) -> DaemonConfig {
    let mut config = DaemonConfig::default();
    config.transports.http.enabled = env.get("ORQUESTER_HTTP_ENABLED").map(|v| v == "true").unwrap_or(false);
    config.transports.http.host = env.get("ORQUESTER_HTTP_HOST").cloned().unwrap_or_else(|| DEFAULT_HTTP_HOST.to_string());
    config.transports.http.port = env
        .get("ORQUESTER_HTTP_PORT")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_HTTP_PORT);
    config.transports.http.password = env.get("ORQUESTER_HTTP_PASSWORD").cloned();
    config.transports.http.username = env.get("ORQUESTER_HTTP_USERNAME").cloned();
    config.transports.http.serve_web = env.get("ORQUESTER_HTTP_SERVE_WEB").map(|value| value == "true").unwrap_or(false);
    if let Some(workspaces_dir) = env.get("ORQUESTER_WORKSPACES_DIR").filter(|value| !value.trim().is_empty()) {
        config.workspaces_dir = workspaces_dir.clone();
    }
    config
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ConnectionConfig {
    Local { id: String, name: String, socket_path: String },
    Remote { id: String, name: String, base_url: String, #[serde(skip_serializing_if = "Option::is_none")] username: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] password: Option<String> },
}

pub fn create_local_connection(socket_path: &str) -> ConnectionConfig {
    ConnectionConfig::Local {
        id: LOCAL_CONNECTION_ID.to_string(),
        name: "Local daemon".to_string(),
        socket_path: socket_path.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConnectionConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

impl Default for RemoteConnectionConfig {
    fn default() -> Self {
        Self { id: String::new(), name: String::new(), base_url: String::new(), username: None, password: None }
    }
}

/// app.json (desktop app config). Clients own this file; the worker must hand
/// back unknown fields untouched instead of dropping a newer client's setting
/// (mirrors the TS schema's `.passthrough()`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut extra = serde_json::Map::new();
        extra.insert("version".into(), 1.into());
        extra.insert("activeConnectionId".into(), LOCAL_CONNECTION_ID.into());
        extra.insert("useTitlebar".into(), true.into());
        extra.insert("runInBackground".into(), false.into());
        extra.insert("startWorkerOnLogin".into(), false.into());
        extra.insert("sidebarOpacity".into(), 0.85.into());
        extra.insert("glassSidebar".into(), false.into());
        extra.insert("titlebarOpacity".into(), 0.85.into());
        extra.insert("glassTitlebar".into(), false.into());
        extra.insert("roundedWindow".into(), true.into());
        extra.insert("theme".into(), "mono".into());
        extra.insert("themeMode".into(), "dark".into());
        extra.insert("quotaResetFormat".into(), "relative".into());
        extra.insert("showQuotaMenu".into(), false.into());
        Self { extra }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RemotesConfig {
    pub version: u32,
    pub remotes: Vec<RemoteConnectionConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClientConfig {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_connection_id: Option<String>,
    pub connections: Vec<ConnectionConfig>,
}

pub fn create_default_client_config(socket_path: &str) -> ClientConfig {
    ClientConfig {
        version: 1,
        active_connection_id: Some(LOCAL_CONNECTION_ID.to_string()),
        connections: vec![create_local_connection(socket_path)],
    }
}
