import type { RemoteConnectionConfig } from "@orquester/config";
import type { UiConnection } from "../types";

/**
 * Persistence for user-added remote servers. The local unix daemon is implicit
 * and never stored here. Each host supplies an adapter: desktop writes
 * `<appdir>/app/remotes.json` over IPC; web uses localStorage.
 */
export interface ConnectionsAdapter {
  load(): Promise<RemoteConnectionConfig[]>;
  save(remotes: RemoteConnectionConfig[]): Promise<void>;
}

export function toUiConnection(remote: RemoteConnectionConfig): UiConnection {
  return {
    id: remote.id,
    name: remote.name,
    kind: "remote",
    endpoint: remote.baseUrl,
    status: "disconnected",
    password: remote.password
  };
}

export function toRemoteConfig(connection: UiConnection): RemoteConnectionConfig {
  return {
    id: connection.id,
    name: connection.name,
    kind: "remote",
    baseUrl: connection.endpoint,
    password: connection.password
  };
}

/** localStorage-backed adapter for the web runtime. */
export function createLocalStorageConnectionsAdapter(
  key = "orquester.remotes"
): ConnectionsAdapter {
  return {
    async load() {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(parsed) ? (parsed as RemoteConnectionConfig[]) : [];
      } catch {
        return [];
      }
    },
    async save(remotes) {
      try {
        localStorage.setItem(key, JSON.stringify(remotes));
      } catch {
        /* storage unavailable */
      }
    }
  };
}
