use crate::bootstrap;
use crate::state::{AppState, TransportMode};
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;

/// Single onRequest-equivalent hook: CORS headers (remote transport only) and
/// bearer-token auth gating `/api*` and `/events` (except the public
/// `/api/auth/info`).
pub async fn auth_and_cors(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    let is_remote = state.options.mode == TransportMode::Remote;
    let is_options = request.method() == Method::OPTIONS;
    let path = request.uri().path().to_string();

    if is_remote && is_options {
        return cors_headers(StatusCode::NO_CONTENT.into_response());
    }

    let needs_auth = state.options.auth_required
        && (path.starts_with("/api") || path.starts_with("/events"))
        && path != "/api/auth/info";

    if needs_auth {
        let expected = state.services.config.daemon.read().await.transports.http.password_hash.clone();
        let expected_username = state.services.config.daemon.read().await.transports.http.username.clone();
        let provided_username = request.headers().get("x-orquester-username").and_then(|value| value.to_str().ok());
        let provided = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")));

        let authorized = match (&expected, &expected_username, provided, provided_username) {
            (Some(expected), Some(expected_username), Some(provided), Some(provided_username)) => bootstrap::safe_equal(expected, provided) && bootstrap::safe_equal(expected_username, provided_username),
            _ => false,
        };
        if !authorized {
            let body = Json(crate::api_types::ApiError::new(
                "UNAUTHORIZED",
                "A valid bearer token is required for this daemon transport.",
            ));
            let response = (StatusCode::UNAUTHORIZED, body).into_response();
            return if is_remote { cors_headers(response) } else { response };
        }
    }

    let response = next.run(request).await;
    if is_remote { cors_headers(response) } else { response }
}

fn cors_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type, x-orquester-username"));
    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, DELETE, OPTIONS"));
    response
}
