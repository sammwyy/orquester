import type {
  AgentSummary,
  EventMessage,
  OpenTargetSummary,
  ProjectSummary,
  RegistryEntry,
  RegistryKind,
  RegistryResponse,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary
} from "@orquester/api";

export type Runtime = "desktop" | "web";

export type ConnectionKind = "local" | "remote";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/**
 * How the host system can blur what sits behind the window: macOS vibrancy,
 * Windows 11 acrylic, or KWin's X11 blur. Systems offering none can't render
 * the glass chrome at all.
 */
export type BlurStrategy = "vibrancy" | "acrylic" | "kwin";

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

export type {
  AgentSummary,
  EventMessage,
  OpenTargetSummary,
  ProjectSummary,
  RegistryEntry,
  RegistryKind,
  RegistryResponse,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary
};
