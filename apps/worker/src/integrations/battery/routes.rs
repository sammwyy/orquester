//! `/api/system/battery`.

use super::service;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub async fn battery() -> Response {
    Json(service::read_battery_status().await).into_response()
}
