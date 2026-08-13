mod agents;
mod api_types;
mod bootstrap;
mod broadcaster;
mod config;
mod integrations;
mod middlewares;
mod paths;
mod registry;
mod routes;
mod sessions;
mod state;
mod transports;

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
    // CLI flag wins over the env var (Electron passes the flag with an
    // already-absolute path but the child still inherits the parent's raw
    // ORQUESTER_APPDIR); either way the chosen value is resolved against cwd.
    let appdir_raw = paths::parse_appdir_arg(&args).or_else(|| env.get("ORQUESTER_APPDIR").cloned());
    let appdir = paths::resolve_appdir(appdir_raw.as_deref(), &cwd);
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

    let broadcaster = Arc::new(Broadcaster::new());
    let registry = Arc::new(RegistryService::new(broadcaster.clone()));
    registry.init().await;
    let sessions = Arc::new(SessionManager::new(registry.clone(), broadcaster.clone()));
    let git_watcher = {
        let broadcaster = broadcaster.clone();
        integrations::git::watch_git_projects(&resolved.workspaces_dir, move |status| {
            broadcaster.publish("projects", "project.git.changed", &status);
        })
    };
    let battery_watcher = {
        let broadcaster = broadcaster.clone();
        integrations::battery::watch_battery(move |status| broadcaster.publish("system", "battery.changed", &status))
    };
    let media_watcher = {
        let broadcaster = broadcaster.clone();
        integrations::media::watch_media(move |status| broadcaster.publish("system", "media.changed", &status))
    };
    let resources_service = Arc::new(integrations::system_resources::SystemResourcesService::new());
    let resources_watcher = {
        let broadcaster = broadcaster.clone();
        integrations::system_resources::watch_system_resources(&resolved.workspaces_dir, resources_service.clone(), move |resources| {
            broadcaster.publish("system", "resources.changed", &resources);
        })
    };
    let networking_watcher = {
        let broadcaster = broadcaster.clone();
        let sessions_for_watch = sessions.clone();
        integrations::networking::watch_networking(
            move || {
                // Session listing is async; the watcher's get_sessions callback is
                // sync, so a snapshot is taken via try_read — an empty list on rare
                // lock contention just skips one poll tick, which is harmless.
                sessions_for_watch.try_list().unwrap_or_default()
            },
            move |status| broadcaster.publish("system", "networking.changed", &status),
        )
    };
    let process_manager_service = Arc::new(integrations::process_manager::ProcessManagerService::new());
    let process_manager_watcher = {
        let broadcaster = broadcaster.clone();
        let sessions_for_watch = sessions.clone();
        integrations::process_manager::watch_process_manager(
            process_manager_service.clone(),
            move || sessions_for_watch.try_list().unwrap_or_default(),
            move |status| broadcaster.publish("system", "processes.changed", &status),
        )
    };
    let keep_awake = integrations::keep_awake::create_keep_awake_controller();

    let services = Arc::new(Services {
        daemon_id: daemon_id.clone(),
        package_version: PACKAGE_VERSION,
        config: SharedConfig { daemon: RwLock::new(daemon_config.clone()), resolved: RwLock::new(resolved) },
        client_config,
        broadcaster,
        registry,
        sessions,
        git_watcher,
        battery_watcher,
        media_watcher,
        resources_watcher,
        resources_service,
        networking_watcher,
        process_manager_watcher,
        process_manager_service,
        keep_awake,
        http_reload: tokio::sync::Notify::new(),
    });

    // Only run the pollers while at least one client is listening for events,
    // and only for integrations enabled in daemon.json and available on this host.
    {
        let services_for_watch = services.clone();
        services.broadcaster.on_client_count_change(move |_count| {
            let services = services_for_watch.clone();
            tokio::spawn(async move { services.apply_integrations().await });
        });
    }

    let local_state = AppState {
        services: services.clone(),
        options: Arc::new(RouterOptions { auth_required: false, mode: TransportMode::Local, serve_web: None }),
    };
    let local_router = transports::router::build_router(local_state);

    // The remote transport optionally serves the bundled apps/web SPA build,
    // Serve the web client when it is available.
    let web_dir = env.get("ORQUESTER_WEB_DIR").map(|dir| cwd.join(dir)).filter(|dir| dir.join("index.html").exists());
    let serve_web = web_dir.map(|dir| dir.to_string_lossy().to_string());

    tracing::info!(daemon_id, socket_path, "orquester worker starting");

    let local_handle = tokio::spawn(async move {
        if let Err(error) = transports::local::serve(&socket_path, local_router).await {
            tracing::error!(%error, "local transport stopped");
        }
    });

    let remote_handle = tokio::spawn(transports::http::run_supervisor(services.clone(), serve_web));

    tokio::signal::ctrl_c().await.expect("failed to listen for ctrl-c");
    tracing::info!("shutting down");
    services.git_watcher.stop();
    services.battery_watcher.stop();
    services.media_watcher.stop();
    services.resources_watcher.stop();
    services.networking_watcher.stop();
    services.process_manager_watcher.stop();
    services.keep_awake.stop();
    services.sessions.close_all().await;
    local_handle.abort();
    remote_handle.abort();
}

fn dirs_home() -> Option<String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE").ok()
    } else {
        std::env::var("HOME").ok()
    }
}
