mod api_types;
mod bootstrap;
mod broadcaster;
mod config;
mod git;
mod host_registry;
mod local_transport;
mod paths;
mod registry;
mod routes;
mod server;
mod sessions;
mod state;

use broadcaster::Broadcaster;
use registry::RegistryService;
use sessions::SessionManager;
use state::{AppState, RouterOptions, Services, SharedConfig, TransportMode};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

const PACKAGE_VERSION: &str = "0.0.0";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("orquester_worker=info".parse().unwrap())).init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().expect("cannot read cwd");
    let env: HashMap<String, String> = std::env::vars().collect();
    let appdir = env.get("ORQUESTER_APPDIR").cloned().or_else(|| paths::parse_appdir(&args, &cwd));
    let home_dir = dirs_home().expect("cannot resolve home directory");
    let platform = if cfg!(windows) { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" };

    let daemon_paths = config::resolve_daemon_paths(config::ResolveDaemonPathsInput {
        home_dir: &home_dir,
        platform,
        cwd: &cwd.to_string_lossy(),
        appdir: appdir.as_deref(),
        env: &env,
    });

    let daemon_config = bootstrap::load_config(&daemon_paths.config_path, &env).await;
    if let Err(message) = bootstrap::validate_transport_config(&daemon_config) {
        tracing::error!("{message}");
        std::process::exit(1);
    }

    let resolved = paths::resolve(&home_dir, platform, &cwd.to_string_lossy(), appdir.as_deref(), &env, &daemon_config);
    if let Err(error) = bootstrap::prepare_dirs(&resolved).await {
        tracing::error!(%error, "failed to prepare worker directories");
        std::process::exit(1);
    }

    let daemon_id = uuid::Uuid::new_v4().to_string();
    let socket_path = daemon_paths.socket_path.clone();
    let client_config = config::create_default_client_config(&socket_path);

    let registry = Arc::new(RegistryService::new());
    registry.init().await;
    let broadcaster = Arc::new(Broadcaster::new());
    let sessions = Arc::new(SessionManager::new(registry.clone(), broadcaster.clone()));
    let git_watcher = {
        let broadcaster = broadcaster.clone();
        git::watch_git_projects(&resolved.workspaces_dir, move |status| {
            broadcaster.publish("projects", "project.git.changed", &status);
        })
    };

    let services = Arc::new(Services {
        daemon_id: daemon_id.clone(),
        package_version: PACKAGE_VERSION,
        config: SharedConfig { daemon: RwLock::new(daemon_config.clone()), resolved: RwLock::new(resolved) },
        client_config,
        broadcaster,
        registry,
        sessions,
        git_watcher,
    });

    // Only run the git status poller while at least one client is listening
    // for events, and only when the git integration is enabled.
    {
        let services_for_watch = services.clone();
        services.broadcaster.on_client_count_change(move |count| {
            let services = services_for_watch.clone();
            tokio::spawn(async move {
                let enabled = services.config.daemon.read().await.integrations.get("git").copied().unwrap_or(true);
                services.git_watcher.set_active(count > 0 && enabled);
            });
        });
    }

    let local_state = AppState {
        services: services.clone(),
        options: Arc::new(RouterOptions { auth_required: false, mode: TransportMode::Local, serve_web: None }),
    };
    let local_router = server::build_router(local_state);

    let http_enabled = daemon_config.transports.http.enabled;
    let http_host = daemon_config.transports.http.host.clone();
    let http_port = daemon_config.transports.http.port;

    tracing::info!(daemon_id, socket_path, "orquester worker starting");

    let local_handle = tokio::spawn(async move {
        if let Err(error) = local_transport::serve(&socket_path, local_router).await {
            tracing::error!(%error, "local transport stopped");
        }
    });

    let remote_handle = if http_enabled {
        let remote_state = AppState {
            services: services.clone(),
            options: Arc::new(RouterOptions { auth_required: true, mode: TransportMode::Remote, serve_web: None }),
        };
        let remote_router = server::build_router(remote_state);
        Some(tokio::spawn(async move {
            match tokio::net::TcpListener::bind((http_host.as_str(), http_port)).await {
                Ok(listener) => {
                    tracing::info!(host = %http_host, port = http_port, "http transport listening");
                    if let Err(error) = axum::serve(listener, remote_router).await {
                        tracing::error!(%error, "http transport stopped");
                    }
                }
                Err(error) => tracing::error!(%error, "failed to bind http transport"),
            }
        }))
    } else {
        None
    };

    tokio::signal::ctrl_c().await.expect("failed to listen for ctrl-c");
    tracing::info!("shutting down");
    services.git_watcher.stop();
    services.sessions.close_all().await;
    local_handle.abort();
    if let Some(handle) = remote_handle {
        handle.abort();
    }
}

fn dirs_home() -> Option<String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE").ok()
    } else {
        std::env::var("HOME").ok()
    }
}
