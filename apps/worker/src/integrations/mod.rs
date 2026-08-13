//! Integration catalog: one module per integration, each owning its service
//! logic (including its background watcher, where it has one) and its HTTP
//! routes. `integration_availability()` is the single source of truth for
//! which integrations exist and whether they're usable on this host.

pub mod battery;
pub mod git;
pub mod keep_awake;
pub mod media;
pub mod networking;
pub mod process_manager;
pub mod system_resources;

use crate::api_types::IntegrationStatus;

pub async fn integration_availability() -> Vec<IntegrationStatus> {
    let (git_available, battery, media_available, keep_awake_available) = tokio::join!(
        git::is_git_available(),
        battery::read_battery_status(),
        media::is_media_available(),
        keep_awake::is_keep_awake_available(),
    );

    vec![
        IntegrationStatus {
            id: "git".to_string(),
            name: "Git".to_string(),
            description: "Repository branch, changes, origin and recent commits.".to_string(),
            enabled: true,
            available: git_available,
            unavailable_reason: (!git_available).then(|| "Git is not installed on this worker.".to_string()),
        },
        IntegrationStatus {
            id: "battery".to_string(),
            name: "Battery".to_string(),
            description: "Battery percentage, charging state and power connection.".to_string(),
            enabled: true,
            // A desktop with no battery is still a valid pluggedIn reading, not an unavailable one.
            available: battery.has_battery || battery.plugged_in,
            unavailable_reason: (!(battery.has_battery || battery.plugged_in)).then(|| "This worker cannot report power status.".to_string()),
        },
        IntegrationStatus {
            id: "system-resources".to_string(),
            name: "System Resources".to_string(),
            description: "CPU, memory and the disk containing this worker's workspaces.".to_string(),
            enabled: true,
            available: true,
            unavailable_reason: None,
        },
        IntegrationStatus {
            id: "media".to_string(),
            name: "Media".to_string(),
            description: "Control the media session playing on this worker.".to_string(),
            enabled: true,
            available: media_available,
            unavailable_reason: (!media_available).then(|| "No supported media session is available on this worker.".to_string()),
        },
        IntegrationStatus {
            id: "keep-awake".to_string(),
            name: "Keep Awake".to_string(),
            description: "Prevent this worker from sleeping or becoming idle while enabled.".to_string(),
            enabled: true,
            available: keep_awake_available,
            unavailable_reason: (!keep_awake_available).then(|| "This worker cannot control its idle or sleep state.".to_string()),
        },
        IntegrationStatus {
            id: "networking".to_string(),
            name: "Networking".to_string(),
            description: "Ports exposed by Orquester child processes and their sessions.".to_string(),
            enabled: true,
            available: true,
            unavailable_reason: None,
        },
        IntegrationStatus {
            id: "process-manager".to_string(),
            name: "Process Manager".to_string(),
            description: "Tree of processes spawned by this worker and its sessions.".to_string(),
            enabled: true,
            available: true,
            unavailable_reason: None,
        },
    ]
}
