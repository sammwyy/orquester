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

    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .max_instances(255)
        .create(pipe_name)?;

    loop {
        if let Err(error) = server.connect().await {
            // A single failed connect must not take down the daemon's only
            // always-on transport — log it and keep serving on a fresh
            // instance instead of propagating.
            tracing::warn!(%error, "named pipe connect failed, recreating the pipe instance");
            server = ServerOptions::new().max_instances(255).create(pipe_name)?;
            continue;
        }

        // Create the next instance before handing this connected one off to
        // a task, so a pipe instance is always available for the next
        // connector (tokio's documented safe pattern for named_pipe servers).
        let connected = std::mem::replace(
            &mut server,
            ServerOptions::new().max_instances(255).create(pipe_name)?,
        );

        let router = router.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(connected);
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
