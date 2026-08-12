use crate::broadcaster::Broadcaster;
use crate::config::{ClientConfig, DaemonConfig};
use crate::paths::ResolvedPaths;
use crate::registry::RegistryService;
use crate::sessions::SessionManager;
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
}

impl Services {
    pub fn bump_event_clients(&self, delta: i64) {
        self.broadcaster.set_client_delta(delta);
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
