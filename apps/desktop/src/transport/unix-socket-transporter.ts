import {
  buildQueryString,
  type StreamHandle,
  type StreamHandlers,
  type Transporter,
  type TransportRequest,
  type TransportResponse
} from "@orquester/ui";

/** Shape exchanged with the Electron main process over IPC for unary requests. */
export interface DesktopBridgeRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  binary?: boolean;
}

export interface DesktopBridgeResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  encoding?: "base64";
}

/** The full bridge the preload exposes for talking to the daemon over the socket. */
export interface DesktopBridge {
  clientVersion: string;
  request(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
  openExternal(url: string): Promise<boolean>;
  workerStatus(): Promise<{ installed: boolean; running: boolean; source: "repository" | "release" }>;
  installWorker(): Promise<{ source: "repository" | "release"; version?: string }>;
  configureWorker(input: { startWorkerOnLogin: boolean; remoteAccess: boolean; port: number; username?: string; password?: string; serveWeb: boolean; workspacesDir?: string }): Promise<void>;
  setWorkerServiceEnabled(enabled: boolean): Promise<void>;
  chooseWorkerWorkspaces(): Promise<string | undefined>;
  startWorker(): Promise<{ socketPath?: string }>;
  stopWorker(): Promise<void>;
  restartWorker(): Promise<void>;
  workerServiceStatus(): Promise<{ installed: boolean; running: boolean }>;
  loadAppConfig(): Promise<Record<string, unknown>>;
  saveAppConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  loadRemotes(): Promise<Array<{ name: string; baseUrl: string; password?: string }>>;
  saveRemotes(remotes: Array<{ name: string; baseUrl: string; password?: string }>): Promise<void>;
  streamOpen(streamId: string, path: string): void;
  streamClose(streamId: string): void;
  onStreamData(cb: (payload: { streamId: string; chunk: string }) => void): () => void;
  onStreamEnd(cb: (payload: { streamId: string }) => void): () => void;
}

/**
 * Transporter for the desktop runtime. The renderer cannot open a unix socket
 * directly, so requests and chunked streams are forwarded over the Electron IPC
 * bridge to the main process, which performs the actual HTTP-over-unix-socket
 * calls to the daemon.
 */
export class UnixSocketTransporter implements Transporter {
  readonly kind = "unix";

  constructor(private readonly bridge: DesktopBridge) {}

  async request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>> {
    const headers: Record<string, string> = { ...req.headers };
    let body: string | undefined;

    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const response = await this.bridge.request({
      method: req.method,
      path: `${req.path}${buildQueryString(req.query)}`,
      headers,
      body
    });

    const data = response.body ? (JSON.parse(response.body) as T) : (undefined as T);

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: response.headers
    };
  }

  async requestBinary(req: TransportRequest): Promise<TransportResponse<Uint8Array>> {
    const response = await this.bridge.request({
      method: req.method,
      path: `${req.path}${buildQueryString(req.query)}`,
      headers: req.headers,
      binary: true
    });
    const raw = response.encoding === "base64" ? atob(response.body) : response.body;
    const data = response.encoding === "base64"
      ? Uint8Array.from(raw, (character) => character.charCodeAt(0))
      : new TextEncoder().encode(raw);
    return { status: response.status, ok: response.ok, data, headers: response.headers };
  }

  openStream(path: string, handlers: StreamHandlers): StreamHandle {
    const streamId = crypto.randomUUID();
    let closed = false;

    const offData = this.bridge.onStreamData(({ streamId: id, chunk }) => {
      if (id === streamId) {
        handlers.onData(chunk);
      }
    });
    const offEnd = this.bridge.onStreamEnd(({ streamId: id }) => {
      if (id === streamId && !closed) {
        closed = true;
        offData();
        offEnd();
        handlers.onEnd();
      }
    });

    this.bridge.streamOpen(streamId, path);

    return {
      close: () => {
        if (closed) {
          return;
        }
        closed = true;
        offData();
        offEnd();
        this.bridge.streamClose(streamId);
      }
    };
  }
}
