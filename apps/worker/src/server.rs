use crate::bootstrap;
use crate::routes;
use crate::state::{AppState, RouterOptions, TransportMode};
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};

/// Builds one Fastify-equivalent Axum app. Called once per transport (local
/// unix/pipe socket, optional remote HTTP) with different auth/CORS options,
/// same shape as `createServer` in apps/daemon/src/index.ts.
pub fn build_router(state: AppState) -> Router {
    let mut router = Router::new()
        .route("/api/auth/info", get(routes::config_routes::auth_info))
        .route("/health", get(routes::config_routes::health))
        .route("/api/info", get(routes::config_routes::info))
        .route(
            "/api/config/daemon",
            get(routes::config_routes::get_daemon_config).put(routes::config_routes::put_daemon_config),
        )
        .route("/api/config/client", get(routes::config_routes::get_client_config))
        .route(
            "/api/config/app",
            get(routes::config_routes::get_app_config).put(routes::config_routes::put_app_config),
        )
        .route(
            "/api/config/remotes",
            get(routes::config_routes::get_remotes_config).put(routes::config_routes::put_remotes_config),
        )
        .route("/api/workspaces", get(routes::workspaces::list_workspaces).post(routes::workspaces::create_workspace))
        .route(
            "/api/workspaces/:workspace/projects",
            get(routes::workspaces::list_projects).post(routes::workspaces::create_project),
        )
        .route("/api/fs", get(routes::fs::list).delete(routes::fs::delete))
        .route("/api/fs/read", get(routes::fs::read))
        .route("/api/fs/search", get(routes::fs::search))
        .route("/api/fs/write", put(routes::fs::write))
        .route("/api/fs/create", post(routes::fs::create))
        .route("/api/fs/move", post(routes::fs::mv))
        .route("/api/fs/copy", post(routes::fs::copy))
        .route("/api/git/status", get(routes::git::status))
        .route("/api/git/init", post(routes::git::init))
        .route("/api/git/branches", get(routes::git::branches))
        .route("/api/git/log", get(routes::git::log))
        .route("/api/git/commit", get(routes::git::commit_detail).post(routes::git::commit))
        .route("/api/git/checkout", post(routes::git::checkout))
        .route("/api/git/stash", get(routes::git::stash_list).post(routes::git::stash_create).delete(routes::git::stash_drop))
        .route("/api/git/stash/apply", post(routes::git::stash_apply))
        .route("/api/git/stash/pop", post(routes::git::stash_pop))
        .route("/api/git/diff", get(routes::git::diff))
        .route("/api/git/stage", post(routes::git::stage))
        .route("/api/git/unstage", post(routes::git::unstage))
        .route("/api/git/discard", post(routes::git::discard))
        .route("/api/git/fetch", post(routes::git::fetch))
        .route("/api/git/pull", post(routes::git::pull))
        .route("/api/registry", get(routes::registry::list))
        .route("/api/registry/:id/version", get(routes::registry::version))
        .route("/api/registry/:id/quota", get(routes::registry::quota))
        .route("/api/registry/:id/install", post(routes::registry::install))
        .route("/api/registry/:id/update", post(routes::registry::update))
        .route("/api/open", post(routes::registry::open))
        .route("/api/sessions", get(routes::sessions::list).post(routes::sessions::create))
        .route("/api/sessions/:id", delete(routes::sessions::close))
        .route("/api/sessions/:id/input", post(routes::sessions::input))
        .route("/api/sessions/:id/resize", post(routes::sessions::resize))
        .route("/api/sessions/:id/output", get(routes::sessions::output))
        .route("/events", get(routes::events::events));

    if state.options.mode == TransportMode::Local {
        router = router.route("/api/daemon/shutdown", post(routes::config_routes::shutdown));
    }

    if let Some(web_dir) = state.options.serve_web.clone() {
        let serve_dir = tower_http::services::ServeDir::new(&web_dir)
            .fallback(tower_http::services::ServeFile::new(format!("{web_dir}/index.html")));
        router = router.fallback_service(serve_dir);
    } else {
        router = router.fallback(not_found);
    }

    router
        .layer(middleware::from_fn_with_state(state.clone(), auth_and_cors))
        .with_state(state)
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(crate::api_types::ApiError::new("NOT_FOUND", "Route not found."))).into_response()
}

/// Single onRequest-equivalent hook: CORS headers (remote transport only) and
/// bearer-token auth gating `/api*` and `/events` (except the public
/// `/api/auth/info`).
async fn auth_and_cors(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    let is_remote = state.options.mode == TransportMode::Remote;
    let is_options = request.method() == Method::OPTIONS;
    let path = request.uri().path().to_string();

    if is_remote && is_options {
        return cors_headers(StatusCode::NO_CONTENT.into_response());
    }

    let needs_auth = state.options.auth_required
        && (path.starts_with("/api") || path.starts_with("/events"))
        && path != "/api/auth/info";

    if needs_auth {
        let expected = state.services.config.daemon.read().await.transports.http.password_hash.clone();
        let provided = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")));

        let authorized = match (&expected, provided) {
            (Some(expected), Some(provided)) => bootstrap::safe_equal(expected, provided),
            _ => false,
        };
        if !authorized {
            let body = Json(crate::api_types::ApiError::new(
                "UNAUTHORIZED",
                "A valid bearer token is required for this daemon transport.",
            ));
            let response = (StatusCode::UNAUTHORIZED, body).into_response();
            return if is_remote { cors_headers(response) } else { response };
        }
    }

    let response = next.run(request).await;
    if is_remote { cors_headers(response) } else { response }
}

fn cors_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, DELETE, OPTIONS"));
    response
}
