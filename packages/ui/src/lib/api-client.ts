import type {
  AgentSummary,
  CreateProjectRequest,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  EventMessage,
  FsListResponse,
  HealthResponse,
  OpenResult,
  OpenTargetSummary,
  ProjectSummary,
  RegistryActionResult,
  RegistryResponse,
  ServerInfoResponse,
  SessionSummary,
  WorkspaceSummary
} from "@orquester/api";
import type { UiConnection } from "../types";
import type {
  StreamHandle,
  StreamHandlers,
  Transporter,
  TransportMethod,
  TransportRequest
} from "./transporter";

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
  ) { }

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

  /** Subscribe to the daemon event bus (NDJSON). Returns an unsubscribe fn. */
  openEvents(onEvent: (event: EventMessage) => void): () => void {
    let buffer = "";
    const handle = this.transporter.openStream("/events", {
      onData: (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim()) {
            try {
              onEvent(JSON.parse(line) as EventMessage);
            } catch {
              /* ignore malformed line */
            }
          }
          newline = buffer.indexOf("\n");
        }
      },
      onEnd: () => undefined
    });
    return () => handle.close();
  }

  // Daemon meta

  health(signal?: AbortSignal): Promise<HealthResponse> {
    return this.send("GET", "/health", { signal });
  }

  info(signal?: AbortSignal): Promise<ServerInfoResponse> {
    return this.send("GET", "/api/info", { signal });
  }

  // Workspaces & projects (filesystem-backed)

  listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    return this.send("GET", "/api/workspaces", { signal });
  }

  createWorkspace(req: CreateWorkspaceRequest, signal?: AbortSignal): Promise<WorkspaceSummary> {
    return this.send("POST", "/api/workspaces", { body: req, signal });
  }

  listProjects(workspace: string, signal?: AbortSignal): Promise<ProjectSummary[]> {
    return this.send("GET", `/api/workspaces/${encodeURIComponent(workspace)}/projects`, { signal });
  }

  // --- File browser --------------------------------------------------------

  listFiles(path: string, signal?: AbortSignal): Promise<FsListResponse> {
    return this.send("GET", "/api/fs", { query: { path }, signal });
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

  // Catalog (agents / open targets)

  listAgents(signal?: AbortSignal): Promise<AgentSummary[]> {
    return this.send("GET", "/api/agents", { signal });
  }

  listOpenTargets(signal?: AbortSignal): Promise<OpenTargetSummary[]> {
    return this.send("GET", "/api/open-targets", { signal });
  }

  // Registry (shells & agents)

  listRegistry(signal?: AbortSignal): Promise<RegistryResponse> {
    return this.send("GET", "/api/registry", { signal });
  }

  installRegistryEntry(id: string): Promise<RegistryActionResult> {
    return this.send("POST", `/api/registry/${encodeURIComponent(id)}/install`);
  }

  updateRegistryEntry(id: string): Promise<RegistryActionResult> {
    return this.send("POST", `/api/registry/${encodeURIComponent(id)}/update`);
  }

  registryVersion(id: string): Promise<RegistryActionResult> {
    return this.send("GET", `/api/registry/${encodeURIComponent(id)}/version`);
  }

  /** Launch an ide/file-explorer/browser target on a path. */
  open(targetId: string, path: string): Promise<OpenResult> {
    return this.send("POST", "/api/open", { body: { targetId, path } });
  }

  // Sessions (PTYs)

  listSessions(projectPath?: string, signal?: AbortSignal): Promise<SessionSummary[]> {
    return this.send("GET", "/api/sessions", {
      query: projectPath ? { projectPath } : undefined,
      signal
    });
  }

  createSession(req: CreateSessionRequest): Promise<SessionSummary> {
    return this.send("POST", "/api/sessions", { body: req });
  }

  closeSession(id: string): Promise<void> {
    return this.send("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
  }

  sendSessionInput(id: string, data: string): Promise<void> {
    return this.send("POST", `/api/sessions/${encodeURIComponent(id)}/input`, { body: { data } });
  }

  resizeSession(id: string, cols: number, rows: number): Promise<void> {
    return this.send("POST", `/api/sessions/${encodeURIComponent(id)}/resize`, {
      body: { cols, rows }
    });
  }

  /** Open the live output stream for a session (buffer replay + live bytes). */
  openSessionOutput(id: string, handlers: StreamHandlers): StreamHandle {
    return this.transporter.openStream(`/api/sessions/${encodeURIComponent(id)}/output`, handlers);
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
