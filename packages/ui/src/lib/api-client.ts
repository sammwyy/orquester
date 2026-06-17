import type {
  AgentSummary,
  CreateProjectRequest,
  CreateWorkspaceRequest,
  HealthResponse,
  OpenTargetSummary,
  ProjectSummary,
  ServerInfoResponse,
  WorkspaceSummary
} from "@orquester/api";
import type { UiConnection } from "../types";
import type { Transporter, TransportMethod, TransportRequest } from "./transporter";

export interface ApiRequestOptions {
  query?: TransportRequest["query"];
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * ApiClient is the "server manager": it owns the active {@link UiConnection}
 * and its {@link Transporter}, and exposes typed daemon endpoints to the
 * services/hooks above it. It does not know or care which transport is in use.
 *
 * NOTE: skeleton — endpoints are wired but no client-side logic/caching yet.
 */
export class ApiClient {
  constructor(
    public readonly connection: UiConnection,
    private readonly transporter: Transporter
  ) {}

  get transportKind(): string {
    return this.transporter.kind;
  }

  /** Low-level escape hatch for endpoints not yet wrapped below. */
  async send<T>(method: TransportMethod, path: string, options: ApiRequestOptions = {}): Promise<T> {
    const response = await this.transporter.request<T>({
      method,
      path,
      query: options.query,
      body: options.body,
      signal: options.signal
    });

    if (!response.ok) {
      throw new ApiError(response.status, method, path);
    }

    return response.data;
  }

  subscribe(channels: string[], handler: (event: unknown) => void): () => void {
    if (!this.transporter.subscribe) {
      return () => undefined;
    }
    return this.transporter.subscribe(channels, handler);
  }

  // --- Daemon meta ---------------------------------------------------------

  health(signal?: AbortSignal): Promise<HealthResponse> {
    return this.send("GET", "/health", { signal });
  }

  info(signal?: AbortSignal): Promise<ServerInfoResponse> {
    return this.send("GET", "/api/info", { signal });
  }

  // --- Workspaces & projects (filesystem-backed) ---------------------------

  listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    return this.send("GET", "/api/workspaces", { signal });
  }

  createWorkspace(req: CreateWorkspaceRequest, signal?: AbortSignal): Promise<WorkspaceSummary> {
    return this.send("POST", "/api/workspaces", { body: req, signal });
  }

  listProjects(workspace: string, signal?: AbortSignal): Promise<ProjectSummary[]> {
    return this.send("GET", `/api/workspaces/${encodeURIComponent(workspace)}/projects`, { signal });
  }

  createProject(
    workspace: string,
    req: CreateProjectRequest,
    signal?: AbortSignal
  ): Promise<ProjectSummary> {
    return this.send("POST", `/api/workspaces/${encodeURIComponent(workspace)}/projects`, {
      body: req,
      signal
    });
  }

  // --- Catalog (agents / open targets) -------------------------------------

  listAgents(signal?: AbortSignal): Promise<AgentSummary[]> {
    return this.send("GET", "/api/agents", { signal });
  }

  listOpenTargets(signal?: AbortSignal): Promise<OpenTargetSummary[]> {
    return this.send("GET", "/api/open-targets", { signal });
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    method: string,
    path: string
  ) {
    super(`Orquester API ${method} ${path} failed with status ${status}`);
    this.name = "ApiError";
  }
}
