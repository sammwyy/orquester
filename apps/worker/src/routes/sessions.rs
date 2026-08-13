//! `/api/sessions*` — PTY lifecycle + live output streaming.

use crate::api_types::{ApiError, CreateSessionRequest, SessionInputRequest, SessionResizeRequest};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use futures::stream::{self, StreamExt};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ListQuery {
    pub project_path: Option<String>,
}

pub async fn list(State(state): State<AppState>, Query(query): Query<ListQuery>) -> Response {
    Json(state.services.sessions.list(query.project_path.as_deref()).await).into_response()
}

pub async fn create(State(state): State<AppState>, Json(body): Json<CreateSessionRequest>) -> Response {
    match state.services.sessions.create(body).await {
        Ok(summary) => Json(summary).into_response(),
        Err(error) => ApiError::response(StatusCode::BAD_REQUEST, "SESSION_UNAVAILABLE", error.0),
    }
}

pub async fn close(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let ok = state.services.sessions.close(&id).await;
    if ok { StatusCode::NO_CONTENT.into_response() } else { StatusCode::NOT_FOUND.into_response() }
}

pub async fn acknowledge(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    match state.services.sessions.acknowledge(&id).await {
        Some(summary) => Json(summary).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

pub async fn input(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<SessionInputRequest>) -> Response {
    state.services.sessions.input(&id, &body.data.unwrap_or_default()).await;
    StatusCode::NO_CONTENT.into_response()
}

pub async fn resize(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<SessionResizeRequest>) -> Response {
    state.services.sessions.resize(&id, body.cols.unwrap_or(0), body.rows.unwrap_or(0)).await;
    StatusCode::NO_CONTENT.into_response()
}

/// Replays the current buffer, then streams raw PTY bytes until the session
/// exits or the client disconnects. Plain chunked HTTP, same as the TS
/// worker, so both transports work identically.
pub async fn output(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Some(summary) = state.services.sessions.get(&id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let buffered = state.services.sessions.buffer(&id).await;
    let already_exited = summary.status == crate::api_types::SessionStatus::Exited;

    if already_exited {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("x-accel-buffering", "no")
            .body(Body::from(buffered))
            .unwrap();
    }

    let Some(receiver) = state.services.sessions.subscribe(&id).await else {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(buffered))
            .unwrap();
    };

    // The session can exit between the status check above and subscribing:
    // its one-shot terminal signal (an empty chunk, see below) is never
    // replayed to a receiver that subscribes after it was already sent, which
    // would otherwise hang this stream forever. Checking is_exited() after a
    // successful subscribe is race-free either way — if it already exited,
    // fall back to the buffered-only response; otherwise any future exit is
    // guaranteed to reach this receiver.
    if state.services.sessions.is_exited(&id).await {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .header("x-accel-buffering", "no")
            .body(Body::from(buffered))
            .unwrap();
    }

    // Sessions signal exit by broadcasting an empty chunk (see sessions.rs);
    // `unfold` lets that terminate the stream instead of just filtering it
    // out, while a lagged receiver just skips forward and keeps streaming.
    let live = stream::unfold(receiver, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(bytes) if bytes.is_empty() => return None,
                Ok(bytes) => return Some((Ok::<Bytes, std::io::Error>(bytes), rx)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    let replay = stream::once(async move { Ok::<Bytes, std::io::Error>(Bytes::from(buffered)) });
    let body_stream = replay.chain(live);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(body_stream))
        .unwrap()
}
