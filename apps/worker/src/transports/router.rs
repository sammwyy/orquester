use crate::integrations;
use crate::middlewares::auth::auth_and_cors;
use crate::routes;
use crate::state::{AppState, TransportMode};
use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};

/// Builds the worker's HTTP router. Called once per transport (local
/// unix/pipe socket, optional remote HTTP) with different auth/CORS options
/// via `state.options`.
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
        .route("/api/git/status", get(integrations::git::routes::status))
        .route("/api/git/init", post(integrations::git::routes::init))
        .route("/api/git/branches", get(integrations::git::routes::branches))
        .route("/api/git/log", get(integrations::git::routes::log))
        .route("/api/git/commit", get(integrations::git::routes::commit_detail).post(integrations::git::routes::commit))
        .route("/api/git/checkout", post(integrations::git::routes::checkout))
        .route(
            "/api/git/stash",
            get(integrations::git::routes::stash_list).post(integrations::git::routes::stash_create).delete(integrations::git::routes::stash_drop),
        )
        .route("/api/git/stash/apply", post(integrations::git::routes::stash_apply))
        .route("/api/git/stash/pop", post(integrations::git::routes::stash_pop))
        .route("/api/git/diff", get(integrations::git::routes::diff))
        .route("/api/git/stage", post(integrations::git::routes::stage))
        .route("/api/git/unstage", post(integrations::git::routes::unstage))
        .route("/api/git/discard", post(integrations::git::routes::discard))
        .route("/api/git/fetch", post(integrations::git::routes::fetch))
        .route("/api/git/pull", post(integrations::git::routes::pull))
        .route("/api/system/battery", get(integrations::battery::routes::battery))
        .route("/api/system/resources", get(integrations::system_resources::routes::resources))
        .route("/api/system/media", get(integrations::media::routes::media))
        .route("/api/system/media/thumbnail", get(integrations::media::routes::media_thumbnail))
        .route("/api/system/media/control", post(integrations::media::routes::media_control))
        .route("/api/system/networking", get(integrations::networking::routes::networking))
        .route("/api/system/networking/kill", post(integrations::networking::routes::networking_kill))
        .route("/api/system/process-manager", get(integrations::process_manager::routes::process_manager))
        .route("/api/system/process-manager/kill", post(integrations::process_manager::routes::process_manager_kill))
        .route("/api/integrations", get(routes::integrations::list).put(routes::integrations::update))
        .route("/api/registry", get(routes::registry::list))
        .route("/api/registry/:id/version", get(routes::registry::version))
        .route("/api/registry/:id/quota", get(routes::registry::quota))
        .route("/api/registry/:id/install", post(routes::registry::install))
        .route(
            "/api/registry/:id/install/password",
            post(routes::registry::install_password).delete(routes::registry::cancel_install_password),
        )
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
