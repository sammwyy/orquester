//! File browser + editor endpoints. Mirrors the `/api/fs*` handlers in
//! Every path is confined to the resolved workspacesDir, the same way
//! integrations/git/routes.rs confines project paths — the local socket /
//! auth boundary alone doesn't stop a remote client with a valid bearer
//! token from touching arbitrary host files, so path confinement is the
//! real gate.

use crate::api_types::{
    ApiError, FsCopyRequest, FsCreateRequest, FsDeleteRequest, FsEntry, FsEntryKind, FsListResponse,
    FsMoveRequest, FsReadResponse, FsSearchMatch, FsSearchResponse, FsWriteRequest,
};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

fn fs_err(error: std::io::Error, fallback: &str) -> Response {
    ApiError::response(StatusCode::BAD_REQUEST, "FS_ERROR", format!("{fallback} ({error})"))
}

/// Confines a client-supplied path to the resolved workspaces directory,
/// mirroring integrations/git/routes.rs's `project_path_for`. Deliberately
/// not `fs::canonicalize` (see `paths::lexical_resolve`'s doc).
fn workspace_path_for(workspaces_dir: &str, path: &str) -> Result<String, Response> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let root = crate::paths::lexical_resolve(&cwd, workspaces_dir);
    let target = crate::paths::lexical_resolve(&cwd, path);
    if target != root && !target.starts_with(&root) {
        return Err(ApiError::response(StatusCode::FORBIDDEN, "FORBIDDEN", "Path is outside the workspaces directory."));
    }
    Ok(target.to_string_lossy().to_string())
}

async fn workspaces_dir(state: &AppState) -> String {
    state.services.config.resolved.read().await.workspaces_dir.clone()
}

#[derive(Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

pub async fn list(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Response {
    let Some(path) = query.path else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match list_files(&path).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => fs_err(error, "Cannot read directory."),
    }
}

async fn list_files(path: &str) -> std::io::Result<FsListResponse> {
    let mut dir = tokio::fs::read_dir(path).await?;
    let mut entries = Vec::new();
    while let Some(dirent) = dir.next_entry().await? {
        let full = dirent.path();
        let file_type = dirent.file_type().await?;
        let kind = if file_type.is_dir() { FsEntryKind::Dir } else { FsEntryKind::File };
        let size = if kind == FsEntryKind::File {
            tokio::fs::metadata(&full).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        entries.push(FsEntry {
            name: dirent.file_name().to_string_lossy().to_string(),
            path: full.to_string_lossy().to_string(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| match (a.kind, b.kind) {
        (FsEntryKind::Dir, FsEntryKind::File) => std::cmp::Ordering::Less,
        (FsEntryKind::File, FsEntryKind::Dir) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    let parent = Path::new(path).parent().map(|p| p.to_string_lossy().to_string());
    let parent = match &parent {
        Some(p) if p == path => None,
        other => other.clone(),
    };
    Ok(FsListResponse { path: path.to_string(), parent, entries })
}

pub async fn read(State(state): State<AppState>, Query(query): Query<PathQuery>) -> Response {
    let Some(path) = query.path else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match tokio::fs::read(&path).await {
        Ok(buffer) => {
            const CAP: usize = 1024 * 1024;
            let truncated = buffer.len() > CAP;
            let slice = &buffer[..buffer.len().min(CAP)];
            Json(FsReadResponse {
                path,
                content: String::from_utf8_lossy(slice).to_string(),
                size: buffer.len() as u64,
                truncated,
            })
            .into_response()
        }
        Err(error) => fs_err(error, "Cannot read file."),
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub path: Option<String>,
    pub query: Option<String>,
    pub regex: Option<String>,
}

const IGNORED_SEARCH_DIRS: &[&str] = &[".git", "node_modules", ".next", "dist", "build"];
const MAX_MATCHES: usize = 500;

pub async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> Response {
    let (Some(root), Some(query)) = (q.path, q.query) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and query required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let root = match workspace_path_for(&workspaces_dir, &root) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let regex = q.regex.as_deref() == Some("true");
    match search_files(&root, &query, regex).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => fs_err(error, "Cannot search files."),
    }
}

async fn search_files(root: &str, query: &str, regex: bool) -> std::io::Result<FsSearchResponse> {
    let pattern = if regex { regex::Regex::new(query).ok() } else { None };
    let mut matches = Vec::new();
    let ignored: HashSet<&str> = IGNORED_SEARCH_DIRS.iter().copied().collect();
    let mut stack = vec![PathBuf::from(root)];

    while let Some(dir) = stack.pop() {
        if matches.len() >= MAX_MATCHES {
            break;
        }
        let mut read = match tokio::fs::read_dir(&dir).await {
            Ok(read) => read,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = read.next_entry().await {
            if matches.len() >= MAX_MATCHES {
                break;
            }
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                let name = entry.file_name();
                if !ignored.contains(name.to_string_lossy().as_ref()) {
                    stack.push(entry.path());
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let Ok(bytes) = tokio::fs::read(entry.path()).await else { continue };
            if bytes.contains(&0) {
                continue; // binary files are not searchable
            }
            let text = String::from_utf8_lossy(&bytes);
            for (index, line) in text.split(['\n']).enumerate() {
                let line = line.strip_suffix('\r').unwrap_or(line);
                if matches.len() >= MAX_MATCHES {
                    break;
                }
                if let Some(pattern) = &pattern {
                    for m in pattern.find_iter(line) {
                        if matches.len() >= MAX_MATCHES {
                            break;
                        }
                        matches.push(FsSearchMatch {
                            path: entry.path().to_string_lossy().to_string(),
                            line: index + 1,
                            column: m.start() + 1,
                            preview: line.trim().to_string(),
                        });
                    }
                } else {
                    let mut offset = 0usize;
                    while let Some(found) = line[offset..].find(query) {
                        if matches.len() >= MAX_MATCHES {
                            break;
                        }
                        let abs = offset + found;
                        matches.push(FsSearchMatch {
                            path: entry.path().to_string_lossy().to_string(),
                            line: index + 1,
                            column: abs + 1,
                            preview: line.trim().to_string(),
                        });
                        offset = abs + query.len().max(1);
                        if offset > line.len() {
                            break;
                        }
                    }
                }
            }
        }
    }

    let truncated = matches.len() >= MAX_MATCHES;
    Ok(FsSearchResponse { query: query.to_string(), matches, truncated })
}

pub async fn write(State(state): State<AppState>, Json(body): Json<FsWriteRequest>) -> Response {
    let (Some(path), Some(content)) = (body.path, body.content) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and content required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    match tokio::fs::write(&path, content).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => fs_err(error, "Cannot write file."),
    }
}

pub async fn create(State(state): State<AppState>, Json(body): Json<FsCreateRequest>) -> Response {
    let (Some(path), Some(kind)) = (body.path, body.kind) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and kind required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let result = match kind {
        FsEntryKind::Dir => tokio::fs::create_dir_all(&path).await,
        FsEntryKind::File => async {
            if let Some(parent) = Path::new(&path).parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await.map(|_| ())
        }
        .await,
    };
    match result {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => fs_err(error, "Cannot create entry."),
    }
}

pub async fn delete(State(state): State<AppState>, Json(body): Json<FsDeleteRequest>) -> Response {
    let Some(path) = body.path else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let metadata = tokio::fs::metadata(&path).await;
    let result = match metadata {
        Ok(m) if m.is_dir() => tokio::fs::remove_dir_all(&path).await,
        Ok(_) => tokio::fs::remove_file(&path).await,
        Err(error) => Err(error),
    };
    match result {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => fs_err(error, "Cannot delete entry."),
    }
}

async fn path_exists(path: &str) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

async fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = tokio::fs::metadata(from).await?;
    if metadata.is_dir() {
        tokio::fs::create_dir_all(to).await?;
        let mut entries = tokio::fs::read_dir(from).await?;
        while let Some(entry) = entries.next_entry().await? {
            let dest = to.join(entry.file_name());
            Box::pin(copy_recursive(&entry.path(), &dest)).await?;
        }
        Ok(())
    } else {
        if let Some(parent) = to.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(from, to).await.map(|_| ())
    }
}

pub async fn mv(State(state): State<AppState>, Json(body): Json<FsMoveRequest>) -> Response {
    let (Some(path), Some(to)) = (body.path, body.to) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and to required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let to = match workspace_path_for(&workspaces_dir, &to) {
        Ok(p) => p,
        Err(response) => return response,
    };
    if path_exists(&to).await {
        return ApiError::response(StatusCode::BAD_REQUEST, "FS_EXISTS", "An entry already exists at the destination.");
    }
    if let Some(parent) = Path::new(&to).parent() {
        if let Err(error) = tokio::fs::create_dir_all(parent).await {
            return fs_err(error, "Cannot move entry.");
        }
    }
    match tokio::fs::rename(&path, &to).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        // EXDEV (cross-device move) falls back to copy + delete, matching the TS worker.
        Err(_) => match copy_recursive(Path::new(&path), Path::new(&to)).await {
            Ok(()) => {
                let cleanup = if tokio::fs::metadata(&path).await.map(|m| m.is_dir()).unwrap_or(false) {
                    tokio::fs::remove_dir_all(&path).await
                } else {
                    tokio::fs::remove_file(&path).await
                };
                match cleanup {
                    Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
                    Err(error) => fs_err(error, "Cannot move entry."),
                }
            }
            Err(error) => fs_err(error, "Cannot move entry."),
        },
    }
}

pub async fn copy(State(state): State<AppState>, Json(body): Json<FsCopyRequest>) -> Response {
    let (Some(path), Some(to)) = (body.path, body.to) else {
        return ApiError::response(StatusCode::BAD_REQUEST, "INVALID_REQUEST", "path and to required.");
    };
    let workspaces_dir = workspaces_dir(&state).await;
    let path = match workspace_path_for(&workspaces_dir, &path) {
        Ok(p) => p,
        Err(response) => return response,
    };
    let to = match workspace_path_for(&workspaces_dir, &to) {
        Ok(p) => p,
        Err(response) => return response,
    };
    if path_exists(&to).await {
        return ApiError::response(StatusCode::BAD_REQUEST, "FS_EXISTS", "An entry already exists at the destination.");
    }
    match copy_recursive(Path::new(&path), Path::new(&to)).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })).into_response(),
        Err(error) => fs_err(error, "Cannot copy entry."),
    }
}
