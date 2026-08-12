//! `/api/git/*`, including confining
//! every project path to the resolved workspacesDir before touching it.

use super::service;
use crate::api_types::{
    ApiError, GitCheckoutRequest, GitCommitRequest, GitFilesRequest, GitInitRequest, GitPathRequest,
    GitStashActionRequest, GitStashCreateRequest, GitStashListResponse, GitWorkingDiffResponse,
};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

/// Deliberately not `fs::canonicalize`: that resolves symlinks and, on
/// Windows, prefixes the result with `\\?\`, which would leak into every
/// path this returns to the client and no longer match what other routes
/// (workspaces, sessions) hand back for the same directory.
fn project_path_for(workspaces_dir: &str, path: &str) -> Result<String, Response> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let root = crate::paths::lexical_resolve(&cwd, workspaces_dir);
    let project = crate::paths::lexical_resolve(&cwd, path);
    if project != root && !project.starts_with(&root) {
        return Err(err(StatusCode::FORBIDDEN, "FORBIDDEN", "Project is outside the workspaces directory."));
    }
    Ok(project.to_string_lossy().to_string())
}

fn git_err(error: std::io::Error, fallback: &str) -> Response {
    err(StatusCode::BAD_REQUEST, "GIT_ERROR", format!("{fallback} ({error})"))
}

async fn workspaces_dir(state: &AppState) -> String {
    state.services.config.resolved.read().await.workspaces_dir.clone()
}

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

pub async fn status(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::read_git_status(&project).await {
        Ok(status) => Json(status).into_response(),
        Err(error) => git_err(error, "Cannot read git status."),
    }
}

pub async fn init(State(state): State<AppState>, Json(body): Json<GitInitRequest>) -> Response {
    let Some(path) = body.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::initialize_git(&project).await {
        Ok(status) => {
            state.services.git_watcher.watch(&project);
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Cannot initialize git repository."),
    }
}

pub async fn branches(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::list_branches(&project).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => git_err(error, "Cannot read branches."),
    }
}

#[derive(Deserialize)]
pub struct LogQuery {
    pub path: Option<String>,
    pub branch: Option<String>,
    pub limit: Option<String>,
    pub skip: Option<String>,
}

pub async fn log(State(state): State<AppState>, Query(q): Query<LogQuery>) -> Response {
    let Some(path) = q.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let limit = q.limit.and_then(|v| v.parse::<i64>().ok()).unwrap_or(100).clamp(1, 500) as usize;
    let skip = q.skip.and_then(|v| v.parse::<i64>().ok()).unwrap_or(0).max(0) as usize;
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::read_log(&project, q.branch.as_deref(), limit, skip).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => git_err(error, "Cannot read commit log."),
    }
}

#[derive(Deserialize)]
pub struct CommitQuery {
    pub path: Option<String>,
    pub hash: Option<String>,
}

pub async fn commit_detail(State(state): State<AppState>, Query(q): Query<CommitQuery>) -> Response {
    let (Some(path), Some(hash)) = (q.path, q.hash) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and hash required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::read_commit(&project, &hash).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => git_err(error, "Cannot read commit."),
    }
}

pub async fn checkout(State(state): State<AppState>, Json(body): Json<GitCheckoutRequest>) -> Response {
    let (Some(path), Some(r#ref)) = (body.path, body.r#ref) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and ref required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::checkout_ref(&project, &r#ref).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Cannot check out ref."),
    }
}

pub async fn stash_list(State(state): State<AppState>, Query(q): Query<PathQuery>) -> Response {
    let Some(path) = q.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::list_stashes(&project).await {
        Ok(stashes) => Json(GitStashListResponse { stashes }).into_response(),
        Err(error) => git_err(error, "Cannot read stashes."),
    }
}

pub async fn stash_create(State(state): State<AppState>, Json(body): Json<GitStashCreateRequest>) -> Response {
    let Some(path) = body.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    if let Err(error) = service::create_stash(&project, body.message.as_deref(), body.include_untracked.unwrap_or(false)).await {
        return git_err(error, "Nothing to stash.");
    }
    match service::read_git_status(&project).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Nothing to stash."),
    }
}

async fn stash_action(state: &AppState, body: GitStashActionRequest, run: impl AsyncFnOnce(&str, &str) -> std::io::Result<()>) -> Response {
    let (Some(path), Some(r#ref)) = (body.path, body.r#ref) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and ref required.");
    };
    let workspaces_dir = workspaces_dir(state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    if let Err(error) = run(&project, &r#ref).await {
        return git_err(error, "Cannot apply stash.");
    }
    match service::read_git_status(&project).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Cannot read git status."),
    }
}

pub async fn stash_apply(State(state): State<AppState>, Json(body): Json<GitStashActionRequest>) -> Response {
    stash_action(&state, body, async |p, r| service::apply_stash(p, r).await).await
}

pub async fn stash_pop(State(state): State<AppState>, Json(body): Json<GitStashActionRequest>) -> Response {
    stash_action(&state, body, async |p, r| service::pop_stash(p, r).await).await
}

pub async fn stash_drop(State(state): State<AppState>, Json(body): Json<GitStashActionRequest>) -> Response {
    let (Some(path), Some(r#ref)) = (body.path, body.r#ref) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and ref required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::drop_stash(&project, &r#ref).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => git_err(error, "Cannot drop stash."),
    }
}

#[derive(Deserialize)]
pub struct DiffQuery {
    pub path: Option<String>,
    pub file: Option<String>,
    pub staged: Option<String>,
}

pub async fn diff(State(state): State<AppState>, Query(q): Query<DiffQuery>) -> Response {
    let (Some(path), Some(file)) = (q.path, q.file) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and file required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let staged = q.staged.as_deref() == Some("true");
    match service::read_working_diff(&project, &file, staged).await {
        Ok(diff) => Json(GitWorkingDiffResponse { diff }).into_response(),
        Err(error) => git_err(error, "Cannot read diff."),
    }
}

async fn files_action(state: &AppState, body: GitFilesRequest, run: impl AsyncFnOnce(&str, &[String]) -> std::io::Result<()>, fallback: &str) -> Response {
    let Some(path) = body.path.filter(|_| !body.files.is_empty()) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and files required.");
    };
    let workspaces_dir = workspaces_dir(state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    if let Err(error) = run(&project, &body.files).await {
        return git_err(error, fallback);
    }
    match service::read_git_status(&project).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, fallback),
    }
}

pub async fn stage(State(state): State<AppState>, Json(body): Json<GitFilesRequest>) -> Response {
    files_action(&state, body, async |p, f| service::stage_files(p, f).await, "Cannot stage files.").await
}

pub async fn unstage(State(state): State<AppState>, Json(body): Json<GitFilesRequest>) -> Response {
    files_action(&state, body, async |p, f| service::unstage_files(p, f).await, "Cannot unstage files.").await
}

pub async fn discard(State(state): State<AppState>, Json(body): Json<GitFilesRequest>) -> Response {
    files_action(&state, body, async |p, f| service::discard_files(p, f).await, "Cannot discard changes.").await
}

pub async fn commit(State(state): State<AppState>, Json(body): Json<GitCommitRequest>) -> Response {
    let message = body.message.as_deref().map(str::trim).filter(|m| !m.is_empty());
    let (Some(path), Some(message)) = (body.path, message) else {
        return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and a non-empty message are required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::commit_changes(&project, message).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Cannot commit."),
    }
}

pub async fn fetch(State(state): State<AppState>, Json(body): Json<GitPathRequest>) -> Response {
    let Some(path) = body.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::fetch_all(&project).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => git_err(error, "Cannot fetch."),
    }
}

pub async fn pull(State(state): State<AppState>, Json(body): Json<GitPathRequest>) -> Response {
    let Some(path) = body.path else { return err(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.") };
    let workspaces_dir = workspaces_dir(&state).await;
    let project = match project_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match service::pull_current_branch(&project).await {
        Ok(status) => {
            state.services.broadcaster.publish("projects", "project.git.changed", &status);
            Json(status).into_response()
        }
        Err(error) => git_err(error, "Cannot pull."),
    }
}
