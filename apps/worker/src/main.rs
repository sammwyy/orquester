mod api_types;
mod config;

use axum::{routing::get, Json, Router};
use serde::Serialize;

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new().route("/health", get(health));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:47831")
        .await
        .expect("failed to bind");
    tracing::info!("orquester worker listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.expect("server error");
}
