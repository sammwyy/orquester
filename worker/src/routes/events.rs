//! `/events` — newline-delimited JSON daemon event bus (lifecycle broadcasts +
//! heartbeat).

use crate::api_types::EventMessage;
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use bytes::Bytes;
use futures::stream::{self, StreamExt};
use std::time::Duration;
use tokio_stream::wrappers::{BroadcastStream, IntervalStream};

#[derive(serde::Deserialize)]
pub struct EventsQuery {
    project: Option<String>,
}

pub async fn events(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    let git_project = match query.project.filter(|project| !project.is_empty()) {
        Some(path) => {
            let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
            match crate::integrations::git::routes::project_path_for(&workspaces_dir, &path) {
                Ok(project) => Some(project),
                Err(response) => return response,
            }
        }
        None => None,
    };
    state.services.bump_event_clients(1);
    if let Some(project) = &git_project {
        state.services.git_watcher.subscribe(project).await;
    }
    let broadcaster = state.services.broadcaster.clone();
    let daemon_id = state.services.daemon_id.clone();

    let subscription_project = git_project.clone();
    let subscription = BroadcastStream::new(broadcaster.subscribe()).filter_map(move |item| {
        let subscription_project = subscription_project.clone();
        async move {
            match item {
                Ok(line) => {
                    let is_for_project = match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(event) if event["channel"] == "projects" && event["type"] == "project.git.changed" => {
                            subscription_project.as_ref().is_some_and(|project| event["payload"]["projectPath"] == *project)
                        }
                        _ => true,
                    };
                    is_for_project.then(|| Ok::<Bytes, std::io::Error>(Bytes::from(format!("{line}\n"))))
                }
                // A lagged receiver just skips the events it missed; still connected.
                Err(_) => None,
            }
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
    let guarded = DropGuardStream { inner: Box::pin(body_stream), services: state.services.clone(), git_project };

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
    git_project: Option<String>,
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
        if let Some(project) = &self.git_project {
            self.services.git_watcher.unsubscribe(project);
        }
    }
}
