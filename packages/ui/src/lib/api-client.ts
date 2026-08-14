import type {
  AgentConversationsResponse,
  AuthInfoResponse,
  BatteryStatusResponse,
  CreateProjectRequest,
  CreateSessionRequest,
  CreateWorkspaceRequest,
  EventMessage,
  GitInitRequest,
  FsListResponse,
  FsReadResponse,
  FsSearchResponse,
  FsCopyRequest,
  FsMoveRequest,
  GitBranchesResponse,
  GitCheckoutRequest,
  GitCommitDetail,
  GitCommitRequest,
  GitFilesRequest,
  GitLogResponse,
  GitStashActionRequest,
  GitStashCreateRequest,
  GitStashListResponse,
  GitStatusResponse,
  GitWorkingDiffResponse,
  IntegrationsResponse,
  HealthResponse,
  HttpExecuteRequest,
  HttpExecuteResponse,
  HttpFileListResponse,
  HttpVariableDeleteRequest,
  HttpVariableListResponse,
  HttpVariableSetRequest,
  MediaControlRequest,
  MediaStatusResponse,
  NetworkStatusResponse,
  OpenResult,
  ProcessManagerResponse,
  ProjectSummary,
  RecentProjectSummary,
  ProjectTemplatesResponse,
  RegistryActionResult,
  RegistryQuota,
  RegistryResponse,
  ServerInfoResponse,
  SessionSummary,
  SystemResourcesResponse,
  WorkspaceSummary
} from "@orquester/api";
import type { AppConfig, DaemonConfig, RemoteConnectionConfig } from "@orquester/config";
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
      const payload = response.data as { message?: string } | undefined;
      throw new ApiError(response.status, method, path, payload?.message);
    }

    return response.data;
  }

  /**
   * Subscribe to the daemon event bus (NDJSON). `onEnd` fires when the stream
   * closes (e.g. the transport restarted) — used to detect disconnects.
   * Returns an unsubscribe fn.
   */
  openEvents(projectPath: string | undefined, onEvent: (event: EventMessage) => void, onEnd?: () => void): () => void {
    let buffer = "";
    const path = projectPath ? `/events?project=${encodeURIComponent(projectPath)}` : "/events";
    const handle = this.transporter.openStream(path, {
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
      onEnd: () => onEnd?.()
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

  /** Public auth metadata (whether a token is required + bcrypt salt to derive it). */
  authInfo(signal?: AbortSignal): Promise<AuthInfoResponse> {
    return this.send("GET", "/api/auth/info", { signal });
  }

  getDaemonConfig(signal?: AbortSignal): Promise<DaemonConfig> {
    return this.send("GET", "/api/config/daemon", { signal });
  }

  /** Update daemon.json. Daemon rejects this (403) over the remote HTTP transport. */
  updateDaemonConfig(patch: Partial<DaemonConfig>): Promise<DaemonConfig> {
    return this.send("PUT", "/api/config/daemon", { body: patch });
  }

  // --- App config + remote servers (shared, daemon-persisted) --------------

  getAppConfig(signal?: AbortSignal): Promise<AppConfig> {
    return this.send("GET", "/api/config/app", { signal });
  }

  updateAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return this.send("PUT", "/api/config/app", { body: patch });
  }

  listRemotes(signal?: AbortSignal): Promise<RemoteConnectionConfig[]> {
    return this.send("GET", "/api/config/remotes", { signal });
  }

  saveRemotes(remotes: RemoteConnectionConfig[]): Promise<RemoteConnectionConfig[]> {
    return this.send("PUT", "/api/config/remotes", { body: remotes });
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

  listRecentProjects(signal?: AbortSignal): Promise<RecentProjectSummary[]> {
    return this.send("GET", "/api/projects/recent", { signal });
  }

  markProjectInteracted(project: ProjectSummary): Promise<RecentProjectSummary> {
    return this.send("POST", "/api/projects/recent", { body: project });
  }

  // --- File browser --------------------------------------------------------

  listFiles(path: string, signal?: AbortSignal): Promise<FsListResponse> {
    return this.send("GET", "/api/fs", { query: { path }, signal });
  }

  readFile(path: string, signal?: AbortSignal): Promise<FsReadResponse> {
    return this.send("GET", "/api/fs/read", { query: { path }, signal });
  }

  searchFiles(path: string, query: string, regex = false, signal?: AbortSignal): Promise<FsSearchResponse> {
    return this.send("GET", "/api/fs/search", { query: { path, query, regex }, signal });
  }

  createFsEntry(path: string, kind: "file" | "dir"): Promise<{ ok: true }> {
    return this.send("POST", "/api/fs/create", { body: { path, kind } });
  }

  saveFile(path: string, content: string): Promise<{ ok: true }> {
    return this.send("PUT", "/api/fs/write", { body: { path, content } });
  }

  deleteFsEntry(path: string): Promise<{ ok: true }> {
    return this.send("DELETE", "/api/fs", { body: { path } });
  }

  moveFsEntry(req: FsMoveRequest): Promise<{ ok: true }> {
    return this.send("POST", "/api/fs/move", { body: req });
  }

  copyFsEntry(req: FsCopyRequest): Promise<{ ok: true }> {
    return this.send("POST", "/api/fs/copy", { body: req });
  }

  gitStatus(projectPath: string, signal?: AbortSignal): Promise<GitStatusResponse> {
    return this.send("GET", "/api/git/status", { query: { path: projectPath }, signal });
  }

  initializeGit(request: GitInitRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/init", { body: request });
  }

  gitBranches(projectPath: string, signal?: AbortSignal): Promise<GitBranchesResponse> {
    return this.send("GET", "/api/git/branches", { query: { path: projectPath }, signal });
  }

  gitLog(
    projectPath: string,
    options: { branch?: string; limit?: number; skip?: number } = {},
    signal?: AbortSignal
  ): Promise<GitLogResponse> {
    return this.send("GET", "/api/git/log", {
      query: { path: projectPath, branch: options.branch, limit: options.limit, skip: options.skip },
      signal
    });
  }

  gitCommit(projectPath: string, hash: string, signal?: AbortSignal): Promise<GitCommitDetail> {
    return this.send("GET", "/api/git/commit", { query: { path: projectPath, hash }, signal });
  }

  gitCheckout(request: GitCheckoutRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/checkout", { body: request });
  }

  gitStashes(projectPath: string, signal?: AbortSignal): Promise<GitStashListResponse> {
    return this.send("GET", "/api/git/stash", { query: { path: projectPath }, signal });
  }

  createGitStash(request: GitStashCreateRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/stash", { body: request });
  }

  applyGitStash(request: GitStashActionRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/stash/apply", { body: request });
  }

  popGitStash(request: GitStashActionRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/stash/pop", { body: request });
  }

  dropGitStash(request: GitStashActionRequest): Promise<{ ok: true }> {
    return this.send("DELETE", "/api/git/stash", { body: request });
  }

  gitWorkingDiff(projectPath: string, file: string, staged: boolean, signal?: AbortSignal): Promise<GitWorkingDiffResponse> {
    return this.send("GET", "/api/git/diff", { query: { path: projectPath, file, staged }, signal });
  }

  stageGitFiles(request: GitFilesRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/stage", { body: request });
  }

  unstageGitFiles(request: GitFilesRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/unstage", { body: request });
  }

  discardGitFiles(request: GitFilesRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/discard", { body: request });
  }

  commitGitChanges(request: GitCommitRequest): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/commit", { body: request });
  }

  fetchGitRemote(projectPath: string): Promise<GitBranchesResponse> {
    return this.send("POST", "/api/git/fetch", { body: { path: projectPath } });
  }

  pullGitBranch(projectPath: string): Promise<GitStatusResponse> {
    return this.send("POST", "/api/git/pull", { body: { path: projectPath } });
  }

  // --- Rest Client -----------------------------------------------------

  listHttpFiles(projectPath: string, signal?: AbortSignal): Promise<HttpFileListResponse> {
    return this.send("GET", "/api/rest-client/files", { query: { path: projectPath }, signal });
  }

  executeHttpRequest(request: HttpExecuteRequest, signal?: AbortSignal): Promise<HttpExecuteResponse> {
    return this.send("POST", "/api/rest-client/execute", { body: request, signal });
  }

  listHttpVariables(projectPath: string, signal?: AbortSignal): Promise<HttpVariableListResponse> {
    return this.send("GET", "/api/rest-client/variables", { query: { path: projectPath }, signal });
  }

  setHttpVariable(request: HttpVariableSetRequest): Promise<{ ok: true }> {
    return this.send("PUT", "/api/rest-client/variables", { body: request });
  }

  deleteHttpVariable(request: HttpVariableDeleteRequest): Promise<{ ok: true }> {
    return this.send("DELETE", "/api/rest-client/variables", { body: request });
  }

  batteryStatus(signal?: AbortSignal): Promise<BatteryStatusResponse> {
    return this.send("GET", "/api/system/battery", { signal });
  }

  getIntegrations(signal?: AbortSignal): Promise<IntegrationsResponse> {
    return this.send("GET", "/api/integrations", { signal });
  }

  systemResources(signal?: AbortSignal): Promise<SystemResourcesResponse> {
    return this.send("GET", "/api/system/resources", { signal });
  }

  mediaStatus(signal?: AbortSignal): Promise<MediaStatusResponse> {
    return this.send("GET", "/api/system/media", { signal });
  }

  async mediaThumbnail(signal?: AbortSignal): Promise<string | null> {
    if (!this.transporter.requestBinary) return null;
    const response = await this.transporter.requestBinary({ method: "GET", path: "/api/system/media/thumbnail", signal });
    if (!response.ok) return null;
    const type = response.headers?.["content-type"] ?? "image/jpeg";
    const bytes = new Uint8Array(response.data.byteLength);
    bytes.set(response.data);
    return URL.createObjectURL(new Blob([bytes.buffer], { type }));
  }

  controlMedia(request: MediaControlRequest): Promise<MediaStatusResponse> {
    return this.send("POST", "/api/system/media/control", { body: request });
  }

  networkingStatus(signal?: AbortSignal): Promise<NetworkStatusResponse> {
    return this.send("GET", "/api/system/networking", { signal });
  }

  killNetworkingProcess(pid: number): Promise<{ ok: true }> {
    return this.send("POST", "/api/system/networking/kill", { body: { pid } });
  }

  processManagerStatus(signal?: AbortSignal): Promise<ProcessManagerResponse> {
    return this.send("GET", "/api/system/process-manager", { signal });
  }

  killProcess(pid: number): Promise<{ ok: true }> {
    return this.send("POST", "/api/system/process-manager/kill", { body: { pid } });
  }

  updateIntegrations(integrations: Record<string, boolean>): Promise<IntegrationsResponse> {
    return this.send("PUT", "/api/integrations", { body: { integrations } });
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

  // Registry state and actions

  listRegistry(signal?: AbortSignal): Promise<RegistryResponse> {
    return this.send("GET", "/api/registry", { signal });
  }

  installRegistryEntry(id: string, elevated = false): Promise<RegistryActionResult> {
    return this.send("POST", `/api/registry/${encodeURIComponent(id)}/install`, { body: { elevated } });
  }

  provideInstallPassword(id: string, password: string): Promise<{ accepted: boolean }> {
    return this.send("POST", `/api/registry/${encodeURIComponent(id)}/install/password`, { body: { password } });
  }

  cancelInstallPassword(id: string): Promise<{ cancelled: boolean }> {
    return this.send("DELETE", `/api/registry/${encodeURIComponent(id)}/install/password`);
  }

  updateRegistryEntry(id: string): Promise<RegistryActionResult> {
    return this.send("POST", `/api/registry/${encodeURIComponent(id)}/update`);
  }

  registryVersion(id: string): Promise<RegistryActionResult> {
    return this.send("GET", `/api/registry/${encodeURIComponent(id)}/version`);
  }

  registryQuota(id: string, signal?: AbortSignal): Promise<RegistryQuota> {
    return this.send("GET", `/api/registry/${encodeURIComponent(id)}/quota`, { signal });
  }

  listProjectTemplates(signal?: AbortSignal): Promise<ProjectTemplatesResponse> {
    return this.send("GET", "/api/registry/templates", { signal });
  }

  /** Launch an ide/file-explorer/browser target on a path. */
  open(targetId: string, path: string): Promise<OpenResult> {
    return this.send("POST", "/api/open", { body: { targetId, path } });
  }

  /** Every installed agent's past conversations for one project, newest first. */
  listAgentConversations(projectPath: string, signal?: AbortSignal): Promise<AgentConversationsResponse> {
    return this.send("GET", "/api/agents/conversations", { query: { path: projectPath }, signal });
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

  acknowledgeSession(id: string): Promise<SessionSummary> {
    return this.send("POST", `/api/sessions/${encodeURIComponent(id)}/acknowledge`);
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
    path: string,
    /** The daemon's own error message, when the response body carried one (e.g. git's stderr). */
    public readonly serverMessage?: string
  ) {
    super(serverMessage ?? `Orquester API ${method} ${path} failed with status ${status}`);
    this.name = "ApiError";
  }
}
