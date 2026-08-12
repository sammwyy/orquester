//! The local transport is always present. On Windows it's a named pipe (the
//! same `\\.\pipe\orquester-daemon` scheme the desktop client already speaks
//! to node-pty's daemon); elsewhere a unix domain socket at the resolved
//! `socketPath`. Axum's built-in `serve()` only drives TCP/unix listeners, so
//! Windows needs its own hyper accept loop over named-pipe connections.

use axum::Router;

#[cfg(windows)]
pub async fn serve(pipe_name: &str, router: Router) -> std::io::Result<()> {
    use hyper_util::rt::TokioIo;
    use hyper_util::service::TowerToHyperService;
    use tokio::net::windows::named_pipe::ServerOptions;

    let mut first_instance = true;
    loop {
        let mut options = ServerOptions::new();
        options.first_pipe_instance(first_instance);
        first_instance = false;
        let server = options.create(pipe_name)?;
        server.connect().await?;

        let router = router.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(server);
            let service = TowerToHyperService::new(router);
            if let Err(error) = hyper::server::conn::http1::Builder::new().serve_connection(io, service).await {
                tracing::debug!(%error, "named pipe connection ended");
            }
        });
    }
}

#[cfg(unix)]
pub async fn serve(socket_path: &str, router: Router) -> std::io::Result<()> {
    let _ = tokio::fs::remove_file(socket_path).await;
    let listener = tokio::net::UnixListener::bind(socket_path)?;
    axum::serve(listener, router).await
}
