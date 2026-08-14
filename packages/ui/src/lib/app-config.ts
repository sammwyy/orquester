import type { AppConfig } from "@orquester/config";
import type { AppConfigAdapter } from "@orquester/core";

export type { AppConfigAdapter } from "@orquester/core";

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
