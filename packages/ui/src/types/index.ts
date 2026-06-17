import type {
  AgentSummary,
  OpenTargetSummary,
  ProjectSummary,
  WorkspaceSummary
} from "@orquester/api";

export type Runtime = "desktop" | "web";

export type ConnectionKind = "local" | "remote";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/**
 * A daemon connection as the UI understands it. The `endpoint` is transport
 * agnostic: `unix:///path/to/daemon.sock` for a local socket or
 * `http(s)://host:port` for a remote daemon.
 */
export interface UiConnection {
  id: string;
  name: string;
  kind: ConnectionKind;
  endpoint: string;
  status: ConnectionStatus;
  /** Bearer token for authenticated (remote/http) daemons. */
  password?: string;
}

export type TabKind = "terminal" | "files" | "agent";

/** A tab open inside the main view of the selected project. */
export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /** For agent tabs, the id of the backing agent adapter. */
  agentId?: string;
}

export type { AgentSummary, OpenTargetSummary, ProjectSummary, WorkspaceSummary };
