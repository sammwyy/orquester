//! Daemon config load/save, password hashing and directory prep — the
//! Startup configuration logic.

use crate::config::DaemonConfig;
use crate::paths::ResolvedPaths;
use std::collections::HashMap;
use std::path::Path;

/// Loads `<daemonDir>/daemon.json`, normalizing onto defaults. Any missing or
/// unparseable file degrades to defaults rather than failing the run — the
/// same fail-safe posture as the rest of the worker.
pub async fn load_config(config_path: &str, env: &HashMap<String, String>) -> DaemonConfig {
    let mut should_persist = false;
    let mut config = match tokio::fs::read_to_string(config_path).await {
        Ok(raw) => match serde_json::from_str::<DaemonConfig>(&raw) {
            Ok(parsed) => parsed,
            Err(error) => {
                tracing::warn!(%error, config_path, "daemon.json is unparseable, using defaults");
                should_persist = true;
                crate::config::create_default_daemon_config(env)
            }
        },
        Err(_) => {
            should_persist = true;
            crate::config::create_default_daemon_config(env)
        }
    };

    if migrate_http_password(&mut config) || should_persist {
        if let Some(parent) = Path::new(config_path).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let _ = persist_config(config_path, &config).await;
    }

    config
}

/// Migrates a legacy/env plaintext `password` into a bcrypt `passwordHash` and
/// drops the plaintext. Returns true when the config changed (needs persisting).
fn migrate_http_password(config: &mut DaemonConfig) -> bool {
    if let Some(password) = config.transports.http.password.take() {
        if config.transports.http.password_hash.is_none() {
            config.transports.http.password_hash = Some(hash_password(&password));
        }
        return true;
    }
    false
}

pub fn hash_password(plaintext: &str) -> String {
    bcrypt::hash(plaintext, bcrypt::DEFAULT_COST).expect("bcrypt hashing failed")
}

/// Constant-time string comparison (mirrors node:crypto timingSafeEqual usage).
pub fn safe_equal(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in ab.iter().zip(bb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn validate_transport_config(config: &DaemonConfig) -> Result<(), String> {
    if config.transports.http.enabled && (config.transports.http.password_hash.is_none() || config.transports.http.username.as_deref().unwrap_or("").is_empty()) {
        return Err(
            "HTTP transport requires a username and password."
                .to_string(),
        );
    }
    Ok(())
}

pub async fn prepare_dirs(resolved: &ResolvedPaths) -> std::io::Result<()> {
    tokio::fs::create_dir_all(&resolved.daemon_dir).await?;
    tokio::fs::create_dir_all(&resolved.logs_dir).await?;
    tokio::fs::create_dir_all(&resolved.workspaces_dir).await?;
    Ok(())
}

pub async fn persist_config(config_path: &str, config: &DaemonConfig) -> std::io::Result<()> {
    if let Some(parent) = Path::new(config_path).parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(config).expect("DaemonConfig always serializes");
    tokio::fs::write(config_path, format!("{json}\n")).await
}

/// Never expose the hash (it's a bearer-equivalent); the client derives its
/// own via the public salt at /api/auth/info.
pub fn sanitize_daemon_config(config: &DaemonConfig) -> DaemonConfig {
    let mut sanitized = config.clone();
    sanitized.transports.http.password = None;
    sanitized.transports.http.password_hash =
        config.transports.http.password_hash.as_ref().map(|_| "********".to_string());
    sanitized
}
