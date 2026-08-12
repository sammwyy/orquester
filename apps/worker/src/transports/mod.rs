//! The worker's two transports: `local` (always-on unix socket / Windows
//! named pipe) and `http` (optional remote TCP listener, reloaded whenever
//! daemon.json's `transports.http` config changes). `router` builds the
//! shared Axum app both transports serve, with auth/CORS applied via
//! `crate::middlewares::auth`.

pub mod http;
pub mod local;
pub mod router;
