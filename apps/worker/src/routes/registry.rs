//! `/api/registry*` and `/api/open`. Version/quota/install endpoints exist
//! for shells/IDEs/browsers (no version flag, no quota concept) but return an
//! honest `NOT_IMPLEMENTED` for agent-only actions until the agent
//! integrations (apps/daemon/src/integrations/agents/*.ts) are ported.

use crate::api_types::{ApiError, OpenRequest};
use crate::state::{AppState, TransportMode};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

pub async fn list(State(state): State<AppState>) -> Response {
    Json(state.services.registry.list().await).into_response()
}

pub async fn version(Path(_id): Path<String>) -> Response {
    err(StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", "Version detection is not ported to the Rust worker yet.")
}

pub async fn quota(Path(_id): Path<String>) -> Response {
    err(StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", "Agent quota reporting is not ported to the Rust worker yet.")
}

pub async fn install(State(state): State<AppState>, Path(_id): Path<String>) -> Response {
    if state.options.mode != TransportMode::Local {
        return err(StatusCode::FORBIDDEN, "LOCAL_ONLY", "Installation is only available on a local daemon.");
    }
    err(StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", "Managed install is not ported to the Rust worker yet.")
}

pub async fn update(Path(_id): Path<String>) -> Response {
    err(StatusCode::NOT_IMPLEMENTED, "NOT_IMPLEMENTED", "Managed update is not ported to the Rust worker yet.")
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
