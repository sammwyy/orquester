export type Runtime = "desktop" | "web" | "native";

export type ConnectionKind = "local" | "remote";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

/** A worker endpoint plus the transient credentials needed to reach it. */
export interface WorkerConnection {
  id: string;
  name: string;
  kind: ConnectionKind;
  endpoint: string;
  status: ConnectionStatus;
  /** Derived bearer token. It must never be persisted with the connection. */
  password?: string;
  username?: string;
}
