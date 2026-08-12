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
 * Windows acrylic (native on Windows 11, experimental on Windows 10), or KWin's X11 blur. Systems offering none can't render
 * the glass chrome at all.
 */
export type BlurStrategy = "vibrancy" | "acrylic" | "win10-acrylic" | "kwin";

/** What the host window can actually do, as reported by the desktop shell. */
export interface WindowCapabilities {
  /** Blur backend behind the window, or null when the system has none. */
  blur: BlurStrategy | null;
  /** Whether the window surface can show what sits behind it. */
  transparency: boolean;
}

/**
 * Light/dark variant of the active colour scheme. "system" follows the OS and
 * "dynamic" follows the time of day; both resolve to light or dark at runtime.
 */
export type ThemeMode = "system" | "light" | "dark" | "dynamic";

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
