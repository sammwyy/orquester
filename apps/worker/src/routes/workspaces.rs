//! `/api/workspaces` and `/api/workspaces/:workspace/projects`.

use crate::api_types::{ApiError, CreateProjectRequest, CreateWorkspaceRequest, ProjectSummary, WorkspaceSummary};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

/// Reject names that would escape the workspaces directory.
fn is_valid_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains('/') && !name.contains('\\')
}

async fn list_directories(path: &std::path::Path) -> std::io::Result<Vec<String>> {
    let mut names = Vec::new();
    let mut entries = match tokio::fs::read_dir(path).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(names),
        Err(error) => return Err(error),
    };
    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() && !name.starts_with('.') {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

pub async fn list_workspaces(State(state): State<AppState>) -> Response {
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let names = match list_directories(std::path::Path::new(&workspaces_dir)).await {
        Ok(names) => names,
        Err(error) => return err(StatusCode::BAD_REQUEST, "FS_ERROR", error.to_string()),
    };
    let mut summaries = Vec::with_capacity(names.len());
    for name in names {
        let path = std::path::Path::new(&workspaces_dir).join(&name);
        let project_count = list_directories(&path).await.map(|p| p.len()).unwrap_or(0);
        summaries.push(WorkspaceSummary { name, path: path.to_string_lossy().to_string(), project_count });
    }
    Json(summaries).into_response()
}

pub async fn create_workspace(State(state): State<AppState>, Json(body): Json<CreateWorkspaceRequest>) -> Response {
    let Some(name) = body.name.filter(|n| is_valid_name(n)) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_NAME", "Invalid workspace name.");
    };
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let path = std::path::Path::new(&workspaces_dir).join(&name);
    if let Err(error) = tokio::fs::create_dir_all(&path).await {
        return err(StatusCode::BAD_REQUEST, "FS_ERROR", error.to_string());
    }
    Json(WorkspaceSummary { name, path: path.to_string_lossy().to_string(), project_count: 0 }).into_response()
}

pub async fn list_projects(State(state): State<AppState>, Path(workspace): Path<String>) -> Response {
    if !is_valid_name(&workspace) {
        return err(StatusCode::BAD_REQUEST, "INVALID_NAME", "Invalid workspace name.");
    }
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let dir = std::path::Path::new(&workspaces_dir).join(&workspace);
    let names = match list_directories(&dir).await {
        Ok(names) => names,
        Err(error) => return err(StatusCode::BAD_REQUEST, "FS_ERROR", error.to_string()),
    };
    let projects: Vec<ProjectSummary> = names
        .into_iter()
        .map(|name| {
            let path = dir.join(&name).to_string_lossy().to_string();
            ProjectSummary { name, workspace: workspace.clone(), path }
        })
        .collect();
    Json(projects).into_response()
}

pub async fn create_project(
    State(state): State<AppState>,
    Path(workspace): Path<String>,
    Json(body): Json<CreateProjectRequest>,
) -> Response {
    let Some(name) = body.name.filter(|n| is_valid_name(n)) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_NAME", "Invalid name.");
    };
    if !is_valid_name(&workspace) {
        return err(StatusCode::BAD_REQUEST, "INVALID_NAME", "Invalid name.");
    }
    let workspaces_dir = state.services.config.resolved.read().await.workspaces_dir.clone();
    let path = std::path::Path::new(&workspaces_dir).join(&workspace).join(&name);
    if let Err(error) = tokio::fs::create_dir_all(&path).await {
        return err(StatusCode::BAD_REQUEST, "FS_ERROR", error.to_string());
    }
    Json(ProjectSummary { name, workspace, path: path.to_string_lossy().to_string() }).into_response()
}
