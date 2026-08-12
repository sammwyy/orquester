//! `/api/registry*` and `/api/open`. `version` runs the entry's plain
//! `versionFlag`; install/update run the entry's installCmd/updateCmd
//! (elevated installs use native Windows UAC). Quota stays an honest
//! `NOT_IMPLEMENTED` until the agent integrations
//! are ported — see
//! registry.rs's module doc.

use crate::api_types::{ApiError, OpenRequest};
use crate::state::{AppState, TransportMode};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

pub async fn list(State(state): State<AppState>) -> Response {
    Json(state.services.registry.list().await).into_response()
}

pub async fn version(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    Json(state.services.registry.version(&id).await).into_response()
}

pub async fn quota(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    Json(state.services.registry.quota(&id).await).into_response()
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct InstallBody {
    pub elevated: Option<bool>,
}

pub async fn install(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<InstallBody>) -> Response {
    if state.options.mode != TransportMode::Local {
        return err(StatusCode::FORBIDDEN, "LOCAL_ONLY", "Installation is only available on a local daemon.");
    }
    let started = state.services.registry.install(&id, body.elevated.unwrap_or(false)).await;
    Json(serde_json::json!({ "started": started })).into_response()
}

pub async fn update(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    if state.options.mode != TransportMode::Local {
        return err(StatusCode::FORBIDDEN, "LOCAL_ONLY", "Updating is only available on a local daemon.");
    }
    let started = state.services.registry.update(&id).await;
    Json(serde_json::json!({ "started": started })).into_response()
}

#[derive(Deserialize, Default)]
pub struct InstallPasswordBody {
    pub password: Option<String>,
}

pub async fn install_password(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<InstallPasswordBody>) -> Response {
    let Some(password) = body.password.filter(|p| !p.is_empty()) else {
        return err(StatusCode::BAD_REQUEST, "PASSWORD_REQUIRED", "A password is required.");
    };
    let accepted = state.services.registry.provide_install_password(&id, &password).await;
    Json(serde_json::json!({ "accepted": accepted })).into_response()
}

pub async fn cancel_install_password(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let cancelled = state.services.registry.cancel_install_password(&id).await;
    Json(serde_json::json!({ "cancelled": cancelled })).into_response()
}

pub async fn open(State(state): State<AppState>, Json(body): Json<OpenRequest>) -> Response {
    if state.options.mode != TransportMode::Local {
        return err(StatusCode::FORBIDDEN, "LOCAL_ONLY", "Opening host applications is only available on a local daemon.");
    }
    let (Some(target_id), Some(path)) = (body.target_id, body.path) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "targetId and path required.");
    };
    Json(state.services.registry.open_target(&target_id, &path).await).into_response()
}
