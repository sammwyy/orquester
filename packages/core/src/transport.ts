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

export type EventHandler = (event: unknown) => void;

export interface StreamHandlers {
  onData: (chunk: string) => void;
  onEnd: () => void;
  onError?: (error: unknown) => void;
}

export interface StreamHandle {
  close(): void;
}

/** Platform-neutral request and stream boundary used by every daemon client. */
export interface Transporter {
  readonly kind: string;
  request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>>;
  requestBinary?(req: TransportRequest): Promise<TransportResponse<Uint8Array>>;
  openStream(path: string, handlers: StreamHandlers): StreamHandle;
}

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
