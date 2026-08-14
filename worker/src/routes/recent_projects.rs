use crate::api_types::ProjectSummary;
use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;

pub async fn list(State(state): State<AppState>) -> impl IntoResponse {
    Json(state.services.recent_projects.list().await)
}

pub async fn mark(State(state): State<AppState>, Json(project): Json<ProjectSummary>) -> impl IntoResponse {
    Json(state.services.recent_projects.mark_interacted(project).await)
}
