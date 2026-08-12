use crate::battery::BatteryWatcher;
use crate::broadcaster::Broadcaster;
use crate::config::{ClientConfig, DaemonConfig};
use crate::git::GitProjectWatcher;
use crate::keep_awake::KeepAwakeController;
use crate::media::MediaWatcher;
use crate::networking::NetworkingWatcher;
use crate::paths::ResolvedPaths;
use crate::registry::RegistryService;
use crate::sessions::SessionManager;
use crate::system_resources::{SystemResourcesService, SystemResourcesWatcher};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct SharedConfig {
    pub daemon: RwLock<DaemonConfig>,
    pub resolved: RwLock<ResolvedPaths>,
}

/// Everything shared between the local and remote transports, mirroring the
/// `Services` bag built once in apps/daemon/src/index.ts and threaded into
/// both Fastify instances.
pub struct Services {
    pub daemon_id: String,
    pub package_version: &'static str,
    pub config: SharedConfig,
    pub client_config: ClientConfig,
    pub broadcaster: Arc<Broadcaster>,
    pub registry: Arc<RegistryService>,
    pub sessions: Arc<SessionManager>,
    pub git_watcher: GitProjectWatcher,
    pub battery_watcher: BatteryWatcher,
    pub media_watcher: MediaWatcher,
    pub resources_watcher: SystemResourcesWatcher,
    pub resources_service: Arc<SystemResourcesService>,
    pub networking_watcher: NetworkingWatcher,
    pub keep_awake: KeepAwakeController,
}

impl Services {
    pub fn bump_event_clients(&self, delta: i64) {
        self.broadcaster.set_client_delta(delta);
    }

    /// Mirrors `applyIntegrations` in apps/daemon/src/index.ts: toggles every
    /// watcher active/inactive based on whether any `/events` client is
    /// connected, whether the integration is enabled in daemon.json, and
    /// whether it's actually available on this host.
    pub async fn apply_integrations(&self) {
        let count = self.broadcaster.client_count();
        let integrations = self.config.daemon.read().await.integrations.clone();
        let is_enabled = |id: &str, default: bool| integrations.get(id).copied().unwrap_or(default);
        let availability = crate::catalog::integration_availability().await;
        let is_available = |id: &str| availability.iter().any(|entry| entry.id == id && entry.available);

        self.git_watcher.set_active(count > 0 && is_enabled("git", true) && is_available("git"));
        self.battery_watcher.set_active(count > 0 && is_enabled("battery", true) && is_available("battery"));
        self.resources_watcher.set_active(count > 0 && is_enabled("system-resources", true) && is_available("system-resources"));
        self.media_watcher.set_active(count > 0 && is_enabled("media", true) && is_available("media"));
        self.keep_awake.set_enabled(is_enabled("keep-awake", false) && is_available("keep-awake"));
        self.networking_watcher.set_active(count > 0 && is_enabled("networking", true) && is_available("networking"));
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TransportMode {
    Local,
    Remote,
}

#[derive(Clone)]
pub struct RouterOptions {
    pub auth_required: bool,
    pub mode: TransportMode,
    pub serve_web: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub services: Arc<Services>,
    pub options: Arc<RouterOptions>,
}
