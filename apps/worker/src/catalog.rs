//! Hand-ported mirror of apps/daemon/src/integrations/catalog.ts.

use crate::api_types::IntegrationStatus;

pub async fn integration_availability() -> Vec<IntegrationStatus> {
    let (git_available, battery, media_available, keep_awake_available) = tokio::join!(
        crate::git::is_git_available(),
        crate::battery::read_battery_status(),
        crate::media::is_media_available(),
        crate::keep_awake::is_keep_awake_available(),
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
    ]
}
