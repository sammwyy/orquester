//! `/api/system/resources`.

use crate::api_types::ApiError;
use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

pub async fn resources(State(state): State<AppState>) -> Response {
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let service = state.services.resources_service.clone();
    let result = tokio::task::spawn_blocking(move || service.read(&workspaces_dir)).await;
    match result {
        Ok(resources) => Json(resources).into_response(),
        Err(_) => err(StatusCode::INTERNAL_SERVER_ERROR, "RESOURCES_ERROR", "Cannot read system resources."),
    }
}
