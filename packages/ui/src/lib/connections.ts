import type { RemoteConnectionConfig } from "@orquester/config";
import type { UiConnection } from "../types";

/**
 * Converters between the persisted remote-server shape (RemoteConnectionConfig,
 * stored on the daemon in remotes.json) and the UI's UiConnection. The local
 * unix daemon connection is implicit and never stored here.
 */
export function toUiConnection(remote: RemoteConnectionConfig): UiConnection {
  return {
    id: remote.id,
    name: remote.name,
    kind: "remote",
    endpoint: remote.baseUrl,
    status: "disconnected",
    username: remote.username
  };
}

export function toRemoteConfig(connection: UiConnection): RemoteConnectionConfig {
  return {
    id: connection.id,
    name: connection.name,
    kind: "remote",
    baseUrl: connection.endpoint
  };
}
