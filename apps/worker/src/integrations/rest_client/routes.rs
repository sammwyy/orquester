//! `/api/rest-client/*` — discover + parse `.http`/`.rest` files under a
//! project, execute a fully-resolved request, and manage that project's
//! stored variables. Path confinement mirrors integrations/git/routes.rs;
//! `execute`'s target URL itself isn't confined since its whole point is
//! reaching arbitrary URLs, not the local filesystem.

use super::{dotenv, parser, service, variables};
use crate::api_types::{ApiError, HttpExecuteRequest, HttpFileListResponse, HttpVariableDeleteRequest, HttpVariableListResponse, HttpVariableSetRequest};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

fn project_path_for(workspaces_dir: &str, path: &str) -> Result<String, Response> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let root = crate::paths::lexical_resolve(&cwd, workspaces_dir);
    let project = crate::paths::lexical_resolve(&cwd, path);
    if project != root && !project.starts_with(&root) {
        return Err(ApiError::response(StatusCode::FORBIDDEN, "FORBIDDEN", "Project is outside the workspaces directory."));
    }
    Ok(project.to_string_lossy().to_string())
}

async fn workspaces_dir(state: &AppState) -> String {
    state.services.config.resolved.read().await.workspaces_dir.clone()
}

async fn appdir(state: &AppState) -> String {
    state.services.config.resolved.read().await.vars.appdir.clone()
}

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

pub async fn files(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    Json(HttpFileListResponse { files: service::discover_and_parse(project).await }).into_response()
}

pub async fn execute(State(state): State<AppState>, Json(body): Json<HttpExecuteRequest>) -> Response {
    let (Some(method), Some(mut url)) = (body.method, body.url) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "method and url required.");
    };
    let mut headers = body.headers.unwrap_or_default();
    let mut req_body = body.body;

    if let Some(project_path) = body.project_path.as_deref() {
        let workspaces_dir = workspaces_dir(&state).await;
        if let Ok(project) = project_path_for(&workspaces_dir, project_path) {
            let mut resolved = variables::load(&appdir(&state).await, &project).await;
            for (key, value) in dotenv::load(&project).await {
                resolved.insert(format!("env_{key}"), value);
            }
            if !resolved.is_empty() {
                url = parser::interpolate(&url, &resolved);
                for header in &mut headers {
                    header.value = parser::interpolate(&header.value, &resolved);
                }
                req_body = req_body.map(|b| parser::interpolate(&b, &resolved));
            }
        }
    }

    Json(service::execute(&method, &url, &headers, req_body.as_deref()).await).into_response()
}

pub async fn list_variables(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let names = variables::list_names(&appdir(&state).await, &project).await;
    Json(HttpVariableListResponse { names }).into_response()
}

pub async fn set_variable(State(state): State<AppState>, Json(body): Json<HttpVariableSetRequest>) -> Response {
    let (Some(path), Some(name), Some(value)) = (body.path, body.name, body.value) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path, name and value required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match variables::set(&appdir(&state).await, &project, &name, &value).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => ApiError::response(StatusCode::BAD_REQUEST, "VARIABLE_ERROR", format!("Could not save variable ({error}).")),
    }
}

pub async fn delete_variable(State(state): State<AppState>, Json(body): Json<HttpVariableDeleteRequest>) -> Response {
    let (Some(path), Some(name)) = (body.path, body.name) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and name required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match variables::delete(&appdir(&state).await, &project, &name).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => ApiError::response(StatusCode::BAD_REQUEST, "VARIABLE_ERROR", format!("Could not delete variable ({error}).")),
    }
}
