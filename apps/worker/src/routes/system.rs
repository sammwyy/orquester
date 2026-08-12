//! `/api/system/*`.

use crate::api_types::{ApiError, KillNetworkProcessRequest, MediaControlRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

pub async fn battery() -> Response {
    Json(crate::battery::read_battery_status().await).into_response()
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

pub async fn media() -> Response {
    Json(crate::media::read_media_status().await).into_response()
}

pub async fn media_thumbnail() -> Response {
    match crate::media::read_media_thumbnail().await {
        Some((data, mime_type)) => Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE, mime_type).body(axum::body::Body::from(data)).unwrap(),
        None => err(StatusCode::NOT_FOUND, "NOT_FOUND", "No media thumbnail available."),
    }
}

pub async fn media_control(Json(body): Json<MediaControlRequest>) -> Response {
    if body.action.is_none() {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "A valid media action is required.");
    }
    Json(crate::media::control_media(&body).await).into_response()
}

pub async fn networking(State(state): State<AppState>) -> Response {
    let sessions = state.services.sessions.list(None).await;
    Json(crate::networking::read_network_status(&sessions).await).into_response()
}

pub async fn networking_kill(State(state): State<AppState>, Json(body): Json<KillNetworkProcessRequest>) -> Response {
    let Some(pid) = body.pid else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "pid required.") };
    let sessions = state.services.sessions.list(None).await;
    match crate::networking::kill_network_process(pid, &sessions).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(message) => err(StatusCode::FORBIDDEN, "PROCESS_NOT_ALLOWED", message),
    }
}
