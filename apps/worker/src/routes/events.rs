//! `/events` — newline-delimited JSON daemon event bus (lifecycle broadcasts +
//! heartbeat).

use crate::api_types::EventMessage;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::Response;
use bytes::Bytes;
use futures::stream::{self, StreamExt};
use std::time::Duration;
use tokio_stream::wrappers::{BroadcastStream, IntervalStream};

pub async fn events(State(state): State<AppState>) -> Response {
    state.services.bump_event_clients(1);
    let broadcaster = state.services.broadcaster.clone();
    let daemon_id = state.services.daemon_id.clone();

    let subscription = BroadcastStream::new(broadcaster.subscribe()).filter_map(|item| async move {
        match item {
            Ok(line) => Some(Ok::<Bytes, std::io::Error>(Bytes::from(format!("{line}\n")))),
            // A lagged receiver just skips the events it missed; still connected.
            Err(_) => None,
        }
    });

    let heartbeat = IntervalStream::new(tokio::time::interval(Duration::from_secs(15))).map(move |_| {
        let event = EventMessage {
            id: uuid::Uuid::new_v4().to_string(),
            channel: "daemon".to_string(),
            kind: "daemon.heartbeat".to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            payload: serde_json::json!({ "daemonId": daemon_id }),
        };
        let line = serde_json::to_string(&event).expect("EventMessage always serializes");
        Ok::<Bytes, std::io::Error>(Bytes::from(format!("{line}\n")))
    });

    let body_stream = stream::select(subscription, heartbeat);

    // Client-count teardown: the stream has no natural "on drop" hook in axum
    // 0.7's Body::from_stream, so this wraps the stream to decrement on end —
    // acceptable here because a `/events` connection either streams forever or
    // the client disconnects, which terminates polling and drops this future,
    // running the guard's Drop impl.
    let guarded = DropGuardStream { inner: Box::pin(body_stream), services: state.services.clone() };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(guarded))
        .unwrap()
}

struct DropGuardStream {
    inner: std::pin::Pin<Box<dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send>>,
    services: std::sync::Arc<crate::state::Services>,
}

impl futures::Stream for DropGuardStream {
    type Item = Result<Bytes, std::io::Error>;
    fn poll_next(mut self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}

impl Drop for DropGuardStream {
    fn drop(&mut self) {
        self.services.bump_event_clients(-1);
    }
}
