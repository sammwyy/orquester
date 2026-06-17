import type { AgentSummary, OpenTargetSummary } from "@orquester/api";
import type { ApiClient } from "../lib/api-client";

/**
 * Known "Open in…" targets the UI offers before the daemon reports real
 * detection results. Skeleton: nothing is actually launched yet.
 */
export const DEFAULT_OPEN_TARGETS: OpenTargetSummary[] = [
  { id: "vscode", name: "VS Code", kind: "ide", available: true },
  { id: "cursor", name: "Cursor", kind: "ide", available: true },
  { id: "zed", name: "Zed", kind: "ide", available: true },
  { id: "intellij", name: "IntelliJ IDEA", kind: "ide", available: true },
  { id: "explorer", name: "File Explorer", kind: "explorer", available: true }
];

/**
 * Catalog of agents and open targets. Falls back to local defaults when the
 * daemon does not yet expose the detection endpoints (skeleton).
 */
export const catalogService = {
  async listAgents(api: ApiClient, signal?: AbortSignal): Promise<AgentSummary[]> {
    try {
      return await api.listAgents(signal);
    } catch {
      return [];
    }
  },

  async listOpenTargets(api: ApiClient, signal?: AbortSignal): Promise<OpenTargetSummary[]> {
    try {
      const targets = await api.listOpenTargets(signal);
      return targets.length ? targets : DEFAULT_OPEN_TARGETS;
    } catch {
      return DEFAULT_OPEN_TARGETS;
    }
  }
};
