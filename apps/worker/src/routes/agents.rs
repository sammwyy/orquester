//! `/api/agents/conversations` — past conversation history for every
//! installed agent, scoped to one project. Read-only aggregation over
//! `crate::agents::list_conversations`; see that module for how each
//! provider's on-disk history format gets mapped to a common shape.

use crate::api_types::{AgentConversationsResponse, ApiError};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

fn project_path_for(workspaces_dir: &str, path: &str) -> Result<String, Response> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let root = crate::paths::lexical_resolve(&cwd, workspaces_dir);
    let project = crate::paths::lexical_resolve(&cwd, path);
    if project != root && !project.starts_with(&root) {
        return Err(ApiError::response(StatusCode::FORBIDDEN, "FORBIDDEN", "Project is outside the workspaces directory."));
    }
    Ok(project.to_string_lossy().to_string())
}

pub async fn conversations(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };

    let lookups = crate::agents::AGENT_DEFS.iter().map(|def| {
        let project = project.clone();
        async move { crate::agents::list_conversations(def.id, &project).await }
    });
    let mut conversations: Vec<_> = futures::future::join_all(lookups).await.into_iter().flatten().collect();
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Json(AgentConversationsResponse { conversations }).into_response()
}
