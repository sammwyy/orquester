use crate::state::{AppState, RouterOptions, Services, TransportMode};
use std::sync::Arc;

/// Owns the remote HTTP transport's whole lifecycle: (re)binds whenever
/// daemon.json's `transports.http` changes (host/port/enabled/password),
/// signaled via `services.http_reload`. Mirrors index.ts's `reloadHttp` —
/// the unix/pipe transport, sessions and every watcher are untouched by a
/// reload here.
pub async fn run_supervisor(services: Arc<Services>, serve_web: Option<String>) {
    let mut current: Option<tokio::sync::oneshot::Sender<()>> = None;
    loop {
        if let Some(shutdown) = current.take() {
            let _ = shutdown.send(());
        }

        let http = services.config.daemon.read().await.transports.http.clone();
        if http.enabled {
            let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
            current = Some(shutdown_tx);

            let remote_state = AppState {
                services: services.clone(),
                options: Arc::new(RouterOptions { auth_required: true, mode: TransportMode::Remote, serve_web: serve_web.clone() }),
            };
            let router = super::router::build_router(remote_state);
            match tokio::net::TcpListener::bind((http.host.as_str(), http.port)).await {
                Ok(listener) => {
                    tracing::info!(host = %http.host, port = http.port, "http transport listening");
                    tokio::spawn(async move {
                        let shutdown = async {
                            let _ = shutdown_rx.await;
                        };
                        if let Err(error) = axum::serve(listener, router).with_graceful_shutdown(shutdown).await {
                            tracing::error!(%error, "http transport stopped");
                        }
                    });
                }
                Err(error) => tracing::error!(%error, "failed to bind http transport"),
            }
        }

        services.http_reload.notified().await;
    }
}
