pub mod routes;
pub mod service;

pub use service::{read_battery_status, watch_battery, BatteryWatcher};
