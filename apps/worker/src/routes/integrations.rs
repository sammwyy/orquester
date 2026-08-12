//! `/api/integrations`.

use crate::api_types::{ApiError, IntegrationsResponse, UpdateIntegrationsRequest};
use crate::state::{AppState, TransportMode};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, Json(ApiError::new(code, message))).into_response()
}

async fn build_response(state: &AppState) -> IntegrationsResponse {
    let daemon = state.services.config.daemon.read().await;
    let available = crate::catalog::integration_availability().await;
    let integrations = available
        .into_iter()
        .map(|mut entry| {
            entry.enabled = daemon.integrations.get(&entry.id).copied().unwrap_or(false) && entry.available;
            entry
        })
        .collect();
    IntegrationsResponse { integrations }
}

pub async fn list(State(state): State<AppState>) -> Response {
    Json(build_response(&state).await).into_response()
}

pub async fn update(State(state): State<AppState>, Json(body): Json<UpdateIntegrationsRequest>) -> Response {
    if state.options.mode != TransportMode::Local {
        return err(StatusCode::FORBIDDEN, "FORBIDDEN", "Integrations can only be changed locally.");
    }
    let available = crate::catalog::integration_availability().await;
    let known: std::collections::HashSet<String> = available.iter().map(|entry| entry.id.clone()).collect();

    {
        let mut daemon = state.services.config.daemon.write().await;
        for (id, enabled) in &body.integrations {
            if known.contains(id) {
                daemon.integrations.insert(id.clone(), *enabled);
            }
        }
        let config_path = state.services.config.resolved.read().await.config_path.clone();
        let _ = crate::bootstrap::persist_config(&config_path, &daemon).await;
    }

    state.services.apply_integrations().await;
    Json(build_response(&state).await).into_response()
}
