//! `/health`, `/api/info`, `/api/auth/info`, `/api/config/*`, `/api/daemon/shutdown`.

use crate::api_types::{ApiError, AuthInfoResponse, HealthResponse, ServerCapabilities, ServerInfoResponse, Transport, TransportMode};
use crate::bootstrap;
use crate::config::{AppConfig, DaemonConfig, RemoteConnectionConfig, RemotesConfig};
use crate::state::{AppState, TransportMode as WorkerMode};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub async fn auth_info(State(state): State<AppState>) -> Json<AuthInfoResponse> {
    let daemon = state.services.config.daemon.read().await;
    let is_remote = state.options.mode == WorkerMode::Remote;
    let hash = daemon.transports.http.password_hash.clone();
    Json(AuthInfoResponse {
        auth_required: is_remote && hash.is_some(),
        salt: hash.map(|h| h.chars().take(29).collect()),
    })
}

pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let daemon = state.services.config.daemon.read().await;
    let mut transports = vec![Transport::Unix];
    if daemon.transports.http.enabled {
        transports.push(Transport::Http);
    }
    let mode = if state.options.mode == WorkerMode::Remote { TransportMode::Remote } else { TransportMode::Local };
    Json(HealthResponse { ok: true, daemon_id: state.services.daemon_id.clone(), version: state.services.package_version.to_string(), mode, transports })
}

pub async fn info(State(state): State<AppState>) -> Json<ServerInfoResponse> {
    let resolved = state.services.config.resolved.read().await;
    Json(ServerInfoResponse {
        name: "Orquester daemon".to_string(),
        data_dir: resolved.daemon_dir.clone(),
        workspaces_dir: resolved.workspaces_dir.clone(),
        capabilities: ServerCapabilities { terminals: true, sessions: true, agents: true, docker: false },
    })
}

pub async fn get_daemon_config(State(state): State<AppState>) -> Json<DaemonConfig> {
    let daemon = state.services.config.daemon.read().await;
    Json(bootstrap::sanitize_daemon_config(&daemon))
}

pub async fn get_client_config(State(state): State<AppState>) -> Json<crate::config::ClientConfig> {
    Json(state.services.client_config.clone())
}

pub async fn put_daemon_config(State(state): State<AppState>, Json(patch): Json<serde_json::Value>) -> Response {
    if !state.options.admin_allowed {
        return ApiError::response(StatusCode::FORBIDDEN, "REMOTE_ADMIN_DISABLED", "Remote daemon administration is disabled.");
    }

    let mut daemon = state.services.config.daemon.write().await;
    let mut merged = daemon.clone();

    if let Some(quota_workers) = patch.get("quotaWorkers").cloned() {
        if let Ok(value) = serde_json::from_value(quota_workers) {
            merged.quota_workers = value;
        }
    }
    if let Some(integrations) = patch.get("integrations").cloned() {
        if let Ok(value) = serde_json::from_value(integrations) {
            merged.integrations = value;
        }
    }
    if let Some(workspaces_dir) = patch.get("workspacesDir").and_then(|v| v.as_str()) {
        merged.workspaces_dir = workspaces_dir.to_string();
    }
    if let Some(logs_dir) = patch.get("logsDir").and_then(|v| v.as_str()) {
        merged.logs_dir = logs_dir.to_string();
    }
    if let Some(shell_access) = patch.get("shellAccess").cloned() {
        if let Ok(value) = serde_json::from_value(shell_access) {
            merged.shell_access = value;
        }
    }
    if let Some(http_patch) = patch.get("transports").and_then(|t| t.get("http")) {
        if let Some(enabled) = http_patch.get("enabled").and_then(|v| v.as_bool()) {
            merged.transports.http.enabled = enabled;
        }
        if let Some(host) = http_patch.get("host").and_then(|v| v.as_str()) {
            merged.transports.http.host = host.to_string();
        }
        if let Some(port) = http_patch.get("port").and_then(|v| v.as_u64()) {
            merged.transports.http.port = port as u16;
        }
        if let Some(password) = http_patch.get("password").and_then(|v| v.as_str()) {
            if password != "********" {
                if password.len() < 8 {
                    return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_PASSWORD", "Password must be at least 8 characters.");
                }
                merged.transports.http.password_hash = Some(bootstrap::hash_password(password));
            }
        }
        if let Some(username) = http_patch.get("username").and_then(|v| v.as_str()) {
            if !username.trim().is_empty() {
                merged.transports.http.username = Some(username.trim().to_string());
            }
        }
        if let Some(serve_web) = http_patch.get("serveWeb").and_then(|v| v.as_bool()) {
            merged.transports.http.serve_web = serve_web;
        }
        if let Some(allow_remote_admin) = http_patch.get("allowRemoteAdmin").and_then(|v| v.as_bool()) {
            merged.transports.http.allow_remote_admin = allow_remote_admin;
        }
    }
    merged.version = 1;

    if merged.transports.http.enabled && (merged.transports.http.password_hash.is_none() || merged.transports.http.username.as_deref().unwrap_or("").is_empty()) {
        return ApiError::response(StatusCode::BAD_REQUEST, "CREDENTIALS_REQUIRED", "Enabling external HTTP access requires a username and password (min 8 chars)." );
    }

    let config_path = state.services.config.resolved.read().await.config_path.clone();
    if let Err(error) = bootstrap::persist_config(&config_path, &merged).await {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_CONFIG", error.to_string());
    }
    *daemon = merged.clone();
    drop(daemon);

    state.services.registry.apply_shell_access(&merged.shell_access).await;

    {
        let mut resolved = state.services.config.resolved.write().await;
        resolved.workspaces_dir = crate::config::expand_vars(&merged.workspaces_dir, &resolved.vars);
        resolved.logs_dir = crate::config::expand_vars(&merged.logs_dir, &resolved.vars);
        let _ = tokio::fs::create_dir_all(&resolved.workspaces_dir).await;
    }

    state.services.apply_integrations().await;
    // Hot-restarts just the HTTP transport (host/port/enabled/password) —
    // sessions, the local transport and every watcher are untouched. See
    // run_remote_transport_supervisor in main.rs.
    state.services.http_reload.notify_one();

    Json(bootstrap::sanitize_daemon_config(&merged)).into_response()
}

pub async fn get_app_config(State(state): State<AppState>) -> Json<AppConfig> {
    let file = state.services.config.resolved.read().await.app_config_file.clone();
    Json(read_app_config_file(&file).await)
}

async fn read_app_config_file(file: &str) -> AppConfig {
    match tokio::fs::read_to_string(file).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub async fn put_app_config(State(state): State<AppState>, Json(patch): Json<serde_json::Map<String, serde_json::Value>>) -> Response {
    let file = state.services.config.resolved.read().await.app_config_file.clone();
    let mut current = read_app_config_file(&file).await;
    for (key, value) in patch {
        current.extra.insert(key, value);
    }
    if let Err(error) = write_json_file(&file, &current).await {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_CONFIG", error.to_string());
    }
    Json(current).into_response()
}

pub async fn get_remotes_config(State(state): State<AppState>) -> Response {
    if state.options.mode == WorkerMode::Remote {
        return ApiError::response(StatusCode::FORBIDDEN, "FORBIDDEN", "Remote connections can only be read locally over the unix socket.");
    }
    let file = state.services.config.resolved.read().await.remotes_file.clone();
    Json(read_remotes_file(&file).await.remotes).into_response()
}

async fn read_remotes_file(file: &str) -> RemotesConfig {
    match tokio::fs::read_to_string(file).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => RemotesConfig::default(),
    }
}

pub async fn put_remotes_config(State(state): State<AppState>, Json(remotes): Json<Vec<RemoteConnectionConfig>>) -> Response {
    if state.options.mode == WorkerMode::Remote {
        return ApiError::response(StatusCode::FORBIDDEN, "FORBIDDEN", "Remote connections can only be changed locally over the unix socket.");
    }
    let file = state.services.config.resolved.read().await.remotes_file.clone();
    let parsed = RemotesConfig { version: 1, remotes };
    if let Err(error) = write_json_file(&file, &parsed).await {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_CONFIG", error.to_string());
    }
    Json(parsed.remotes).into_response()
}

async fn write_json_file(file: &str, value: &impl serde::Serialize) -> std::io::Result<()> {
    if let Some(parent) = std::path::Path::new(file).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(value).expect("value always serializes");
    tokio::fs::write(file, format!("{json}\n")).await
}

pub async fn shutdown(State(state): State<AppState>) -> Response {
    if !state.options.admin_allowed {
        return ApiError::response(StatusCode::FORBIDDEN, "REMOTE_ADMIN_DISABLED", "Remote daemon administration is disabled.");
    }
    state.services.broadcaster.publish("daemon", "daemon.shutdown", &serde_json::json!({}));
    let shutdown = state.services.shutdown.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        shutdown.notify_waiters();
    });
    StatusCode::NO_CONTENT.into_response()
}

pub async fn update_worker(State(state): State<AppState>) -> Response {
    if !state.options.admin_allowed {
        return ApiError::response(StatusCode::FORBIDDEN, "REMOTE_ADMIN_DISABLED", "Remote daemon administration is disabled.");
    }
    match crate::self_update::update().await {
        Ok(()) => {
            let shutdown = state.services.shutdown.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                shutdown.notify_waiters();
            });
            Json(serde_json::json!({ "started": true })).into_response()
        }
        Err(error) => ApiError::response(StatusCode::BAD_REQUEST, "UPDATE_FAILED", error),
    }
}

pub async fn worker_service(State(state): State<AppState>, axum::extract::Path(action): axum::extract::Path<String>) -> Response {
    if !state.options.admin_allowed {
        return ApiError::response(StatusCode::FORBIDDEN, "REMOTE_ADMIN_DISABLED", "Remote daemon administration is disabled.");
    }
    let appdir = state.services.config.resolved.read().await.vars.appdir.clone();
    match crate::service_management::execute(&action, Some(&appdir)) {
        Ok(output) => Json(serde_json::json!({ "ok": true, "output": output })).into_response(),
        Err(error) => ApiError::response(StatusCode::BAD_REQUEST, "SERVICE_ACTION_FAILED", error),
    }
}
