import type { ClientConfig, DaemonConfig } from "@orquester/config";

export type RuntimeMode = "desktop-local" | "desktop-remote" | "web-remote";

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface HealthResponse {
  ok: true;
  daemonId: string;
  version: string;
  mode: "local" | "remote";
  transports: Array<"unix" | "http">;
}

export interface ServerInfoResponse {
  name: string;
  dataDir: string;
  workspacesDir: string;
  capabilities: {
    terminals: boolean;
    sessions: boolean;
    agents: boolean;
    docker: boolean;
  };
}

/**
 * A workspace is a top-level directory inside the daemon `workspacesDir`.
 * `(workspacesDir)/<name>` => workspace "name".
 */
export interface WorkspaceSummary {
  name: string;
  path: string;
  projectCount: number;
}

/**
 * A project is a sub-directory of a workspace directory.
 * `(workspacesDir)/<workspace>/<name>` => project "name".
 */
export interface ProjectSummary {
  name: string;
  workspace: string;
  path: string;
}

export interface GitStatusResponse {
  projectPath: string;
  branch: string;
  origin?: string;
  additions: number;
  deletions: number;
  commits: {
    hash: string;
    subject: string;
    author: string;
    date: string;
  }[];
  files: {
    path: string;
    status: string;
  }[];
}

export interface GitInitRequest {
  path: string;
}

export interface GitBranchSummary {
  name: string;
  remote: boolean;
  current: boolean;
  commitHash: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitBranchesResponse {
  branches: GitBranchSummary[];
  /** null when HEAD is detached. */
  currentBranch: string | null;
  detachedAt: string | null;
}

/** One row of a `git log`, with parent hashes so the client can lay out the DAG. */
export interface GitCommitSummary {
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  /** Branch/tag/HEAD decorations pointing at this commit. */
  refs: string[];
}

export interface GitLogResponse {
  commits: GitCommitSummary[];
  hasMore: boolean;
}

export interface GitCommitFile {
  path: string;
  /** Raw git status letter: A, M, D, R100, etc. */
  status: string;
  additions: number;
  deletions: number;
}

export interface GitCommitDetail {
  hash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  files: GitCommitFile[];
  /** Unified diff patch text for the whole commit. */
  diff: string;
}

export interface GitCheckoutRequest {
  path: string;
  ref: string;
}

/** A stash is internally a commit, so its diff is fetched the same way as any commit's (via `hash`/`ref`). */
export interface GitStashSummary {
  index: number;
  ref: string;
  hash: string;
  branch: string;
  message: string;
  date: string;
}

export interface GitStashListResponse {
  stashes: GitStashSummary[];
}

export interface GitStashActionRequest {
  path: string;
  ref: string;
}

export interface GitStashCreateRequest {
  path: string;
  message?: string;
  includeUntracked?: boolean;
}

export interface GitWorkingDiffResponse {
  diff: string;
}

/** Shared shape for stage/unstage/discard — an explicit path list, not an implicit "all". */
export interface GitFilesRequest {
  path: string;
  files: string[];
}

export interface GitCommitRequest {
  path: string;
  message: string;
}

export interface BatteryStatusResponse {
  hasBattery: boolean;
  percentage?: number;
  charging: boolean;
  pluggedIn: boolean;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
}

export interface IntegrationsResponse {
  integrations: IntegrationStatus[];
}

export interface UpdateIntegrationsRequest {
  integrations: Record<string, boolean>;
}

export interface ResourceUsage {
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
  percentage: number;
}

export interface SystemResourcesResponse {
  cpu: { percentage: number; cores: number };
  memory: ResourceUsage;
  disk: ResourceUsage & { mount: string; path: string };
}

export type MediaPlaybackState = "playing" | "paused" | "stopped";

export interface MediaStatusResponse {
  available: boolean;
  player?: string;
  title?: string;
  artist?: string;
  album?: string;
  state: MediaPlaybackState;
  volume: number;
  volumeAvailable: boolean;
  thumbnailKey?: string;
}

export interface MediaControlRequest {
  action: "previous" | "playPause" | "next" | "volume";
  volume?: number;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface CreateProjectRequest {
  name: string;
}

/** A filesystem entry returned by the file browser. */
export interface FsEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
}

export interface FsListResponse {
  path: string;
  /** Parent directory, or null at the filesystem root. */
  parent: string | null;
  entries: FsEntry[];
}

export interface FsReadResponse {
  path: string;
  content: string;
  size: number;
  /** True when the file was larger than the read cap and content is partial. */
  truncated: boolean;
}

export interface FsCreateRequest {
  path: string;
  kind: "file" | "dir";
}

export interface FsWriteRequest {
  path: string;
  content: string;
}

export interface FsDeleteRequest {
  path: string;
}

/** Rename or move an entry; `to` must not already exist. */
export interface FsMoveRequest {
  path: string;
  to: string;
}

/** Copy an entry (file or directory, recursively); `to` must not already exist. */
export interface FsCopyRequest {
  path: string;
  to: string;
}

export interface FsSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface FsSearchResponse {
  query: string;
  matches: FsSearchMatch[];
  truncated: boolean;
}

/** Public auth metadata for the HTTP transport (no secrets). */
export interface AuthInfoResponse {
  authRequired: boolean;
  /** bcrypt salt prefix the client uses to derive the bearer hash, or null. */
  salt: string | null;
}

/** A pluggable coding agent the daemon detected on the host. */
export interface AgentSummary {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
}

/** An editor/IDE or OS tool a project folder can be opened with. */
export interface OpenTargetSummary {
  id: string;
  name: string;
  kind: "ide" | "explorer" | "terminal";
  available: boolean;
}

// Registry — shells & agents share the same shape.

export type RegistryKind = "shell" | "agent" | "ide" | "file-explorer" | "browser";

/** Kinds that launch a persistent PTY session. */
export type SessionKind = Extract<RegistryKind, "shell" | "agent">;

/** Kinds the "Open in…" menu can launch (fire-and-forget, with a path). */
export type OpenKind = Extract<RegistryKind, "ide" | "file-explorer" | "browser">;

/** Lifecycle of a daemon-managed install/update for an agent. */
export type RegistryInstallState = "idle" | "installing" | "error";

export interface RegistryEntry {
  id: string;
  name: string;
  kind: RegistryKind;
  /** True when the daemon found the tool installed and usable. */
  enabled: boolean;
  version?: string;
  canInstall: boolean;
  canUpdate: boolean;
  installCommand?: string;
  websiteUrl?: string;
  missingDependencies: string[];
  /** Live install/update status (daemon-managed, streamed over events). */
  installState: RegistryInstallState;
  /** Captured output when `installState === "error"`. */
  installError?: string;
}

export interface RegistryResponse {
  shells: RegistryEntry[];
  agents: RegistryEntry[];
  ides: RegistryEntry[];
  fileExplorers: RegistryEntry[];
  browsers: RegistryEntry[];
}

export interface RegistryActionResult {
  ok: boolean;
  exitCode: number;
  output: string;
}

export type QuotaPeriod = "hourly" | "daily" | "weekly" | "monthly" | "rolling" | "unknown";
export type QuotaUnit = "requests" | "tokens" | "credits" | "unknown";
export type RegistryAuthStatus = "authenticated" | "unauthenticated" | "unknown";

export interface RegistryAuthInfo {
  status: RegistryAuthStatus;
  /** Optional non-sensitive account label supplied by the provider. */
  account?: string;
  message?: string;
}

export interface QuotaWindow {
  id: string;
  label: string;
  period: QuotaPeriod;
  unit: QuotaUnit;
  limit?: number;
  used?: number;
  remaining?: number;
  percentUsed?: number;
  resetsAt?: string;
  /** Original provider text, retained when a timestamp cannot be normalized. */
  resetLabel?: string;
}

export interface RegistryQuota {
  id: string;
  provider: string;
  auth: RegistryAuthInfo;
  supported: boolean;
  fetchedAt: string;
  windows: QuotaWindow[];
  message?: string;
}

export interface OpenRequest {
  /** Registry entry id of an ide/file-explorer/browser target. */
  targetId: string;
  /** Absolute path to open (a project folder). */
  path: string;
}

export interface OpenResult {
  ok: boolean;
  message?: string;
}

// Sessions — a live PTY (shell or agent) owned by the daemon. Open sessions
// for a project are that project's tabs; they outlive client disconnects.

export type SessionStatus = "running" | "exited";

export interface SessionSummary {
  id: string;
  kind: RegistryKind;
  /** Registry entry id this session was launched from (e.g. "bash", "claude"). */
  refId: string;
  title: string;
  /** Project the tab belongs to ("" = not bound to a project). */
  projectPath: string;
  cwd: string;
  cols: number;
  rows: number;
  status: SessionStatus;
  exitCode?: number;
  createdAt: string;
  pid?: number;
}

export interface NetworkPort {
  protocol: "tcp";
  address: string;
  port: number;
  pid: number;
  process: string;
  sessionId?: string;
}

export interface NetworkStatusResponse {
  ports: NetworkPort[];
}

export interface KillNetworkProcessRequest {
  pid: number;
}

export interface CreateSessionRequest {
  kind: RegistryKind;
  refId: string;
  projectPath?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export interface SessionInputRequest {
  data: string;
}

export interface SessionResizeRequest {
  cols: number;
  rows: number;
}

/** Frames pushed from daemon to client over the session stream. */
export type SessionStreamMessage =
  | { type: "buffer"; data: string }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };

/** Frames sent from client to daemon over the session stream. */
export type SessionInputMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export interface EventMessage<TPayload = unknown> {
  id: string;
  channel: string;
  type: string;
  createdAt: string;
  payload: TPayload;
}

export interface SubscriptionRequest {
  channels: string[];
}

export interface OrquesterApi {
  health(): Promise<HealthResponse>;
  info(): Promise<ServerInfoResponse>;
  daemonConfig(): Promise<DaemonConfig>;
  clientConfig(): Promise<ClientConfig>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listProjects(workspace: string): Promise<ProjectSummary[]>;
}

export interface HttpApiClientOptions {
  baseUrl: string;
  password?: string;
  fetch?: typeof fetch;
}

export class HttpOrquesterApiClient implements OrquesterApi {
  private readonly baseUrl: string;
  private readonly password?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.password = options.password;
    this.fetchImpl = options.fetch ?? fetch;
  }

  health(): Promise<HealthResponse> {
    return this.get("/health");
  }

  info(): Promise<ServerInfoResponse> {
    return this.get("/api/info");
  }

  daemonConfig(): Promise<DaemonConfig> {
    return this.get("/api/config/daemon");
  }

  clientConfig(): Promise<ClientConfig> {
    return this.get("/api/config/client");
  }

  listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.get("/api/workspaces");
  }

  listProjects(workspace: string): Promise<ProjectSummary[]> {
    return this.get(`/api/workspaces/${encodeURIComponent(workspace)}/projects`);
  }

  eventsUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/events";
    return url.toString();
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: this.authHeaders()
    });

    if (!response.ok) {
      throw new Error(`Orquester API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private authHeaders(): HeadersInit {
    if (!this.password) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.password}`
    };
  }
}
