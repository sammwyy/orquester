import type { ProjectSummary, WorkspaceSummary } from "@orquester/api";
import { useApi } from "../context/orquester-context";
import { workspaceService } from "../services";
import { useAsyncResource, type AsyncResource } from "./use-async-resource";

/** List the workspace folders exposed by the connected daemon. */
export function useWorkspaces(): AsyncResource<WorkspaceSummary[]> {
  const api = useApi();
  return useAsyncResource<WorkspaceSummary[]>(
    (signal) => workspaceService.list(api, signal),
    [],
    [api]
  );
}

/** List the projects inside a workspace, or nothing when none is open. */
export function useProjects(workspace: string | null): AsyncResource<ProjectSummary[]> {
  const api = useApi();
  return useAsyncResource<ProjectSummary[]>(
    (signal) => (workspace ? workspaceService.listProjects(api, workspace, signal) : Promise.resolve([])),
    [],
    [api, workspace]
  );
}
