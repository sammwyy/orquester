import type { AppConfig, RemoteConnectionConfig } from "@orquester/config";

/**
 * Persistence for the app's own config. It is per-client, so each runtime
 * supplies its own store: web uses localStorage; desktop omits this and the
 * store falls back to the daemon (app.json under the appdir).
 */
export interface AppConfigAdapter {
  load(): Promise<Partial<AppConfig>>;
  save(config: AppConfig): Promise<void>;
  loadRemotes?(): Promise<RemoteConnectionConfig[]>;
  saveRemotes?(remotes: RemoteConnectionConfig[]): Promise<void>;
}

export function createLocalStorageAppConfigAdapter(key = "orquester.app"): AppConfigAdapter {
  return {
    async load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Partial<AppConfig>) : {};
      } catch {
        return {};
      }
    },
    async save(config) {
      try {
        localStorage.setItem(key, JSON.stringify(config));
      } catch {
        /* storage unavailable */
      }
    }
  };
}
