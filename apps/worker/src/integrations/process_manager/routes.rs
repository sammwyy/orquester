//! `/api/system/process-manager*`.

use crate::api_types::{ApiError, KillProcessRequest, ProcessManagerResponse};
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub async fn process_manager(State(state): State<AppState>) -> Response {
    let sessions = state.services.sessions.list(None).await;
    let service = state.services.process_manager_service.clone();
    match tokio::task::spawn_blocking(move || service.read(&sessions)).await {
        Ok(response) => Json(response).into_response(),
        Err(_) => Json(ProcessManagerResponse { roots: Vec::new() }).into_response(),
    }
}

pub async fn process_manager_kill(State(state): State<AppState>, Json(body): Json<KillProcessRequest>) -> Response {
    let Some(pid) = body.pid else { return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "pid required.") };
    let service = state.services.process_manager_service.clone();
    match tokio::task::spawn_blocking(move || service.kill(pid)).await {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })).into_response(),
        Ok(Err(message)) => ApiError::response(StatusCode::FORBIDDEN, "PROCESS_NOT_ALLOWED", message),
        Err(_) => ApiError::response(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Could not stop process."),
    }
}
