//! `/api/system/media*`.

use super::service;
use crate::api_types::{ApiError, MediaControlRequest};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

pub async fn media() -> Response {
    Json(service::read_media_status().await).into_response()
}

pub async fn media_thumbnail() -> Response {
    match service::read_media_thumbnail().await {
        Some((data, mime_type)) => Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE, mime_type).body(axum::body::Body::from(data)).unwrap(),
        None => err(StatusCode::NOT_FOUND, "NOT_FOUND", "No media thumbnail available."),
    }
}

pub async fn media_control(Json(body): Json<MediaControlRequest>) -> Response {
    if body.action.is_none() {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "A valid media action is required.");
    }
    Json(service::control_media(&body).await).into_response()
}
