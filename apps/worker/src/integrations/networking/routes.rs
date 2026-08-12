//! `/api/system/networking*`.

use super::service;
use crate::api_types::{ApiError, KillNetworkProcessRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub async fn networking(State(state): State<AppState>) -> Response {
    let sessions = state.services.sessions.list(None).await;
    Json(service::read_network_status(&sessions).await).into_response()
}

pub async fn networking_kill(State(state): State<AppState>, Json(body): Json<KillNetworkProcessRequest>) -> Response {
    let Some(pid) = body.pid else { return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "pid required.") };
    let sessions = state.services.sessions.list(None).await;
    match service::kill_network_process(pid, &sessions).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(message) => ApiError::response(StatusCode::FORBIDDEN, "PROCESS_NOT_ALLOWED", message),
    }
}
