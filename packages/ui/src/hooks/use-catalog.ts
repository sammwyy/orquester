import type { AgentSummary, OpenTargetSummary } from "@orquester/api";
import { useApi } from "../context/orquester-context";
import { catalogService } from "../services";
import { useAsyncResource, type AsyncResource } from "./use-async-resource";

/** Installed agent adapters (empty until the daemon detects any). */
export function useAgents(): AsyncResource<AgentSummary[]> {
  const api = useApi();
  return useAsyncResource<AgentSummary[]>(
    (signal) => catalogService.listAgents(api, signal),
    [],
    [api]
  );
}

/** Editors/tools the project folder can be opened with. */
export function useOpenTargets(): AsyncResource<OpenTargetSummary[]> {
  const api = useApi();
  return useAsyncResource<OpenTargetSummary[]>(
    (signal) => catalogService.listOpenTargets(api, signal),
    [],
    [api]
  );
}
