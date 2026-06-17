/**
 * A Transporter is a thin wrapper that maps logical HTTP-style requests
 * (method + path + body) onto a concrete network transport. Each runtime
 * supplies its own implementation:
 *
 *  - desktop (local):  a unix-domain-socket transporter (over the Electron IPC bridge)
 *  - desktop (remote): a custom HTTP-client transporter
 *  - web:              an HTTP transporter wrapping `fetch`
 *
 * Keeping this interface tiny means the rest of the app (ApiClient, services,
 * hooks) never needs to know how bytes reach the daemon.
 */

export type TransportMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TransportRequest {
  method: TransportMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TransportResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers?: Record<string, string>;
}

/** Handler invoked for every event pushed over a realtime subscription. */
export type EventHandler = (event: unknown) => void;

export interface Transporter {
  /** Short identifier for diagnostics, e.g. "unix" | "http". */
  readonly kind: string;
  /** Perform a single request/response round trip. */
  request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>>;
  /**
   * Subscribe to the daemon event stream. Optional: not every transport
   * supports realtime yet. Returns an unsubscribe function.
   */
  subscribe?(channels: string[], handler: EventHandler): () => void;
}

/** Build a querystring (with leading `?`) from a query object, or "" if empty. */
export function buildQueryString(query?: TransportRequest["query"]): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
