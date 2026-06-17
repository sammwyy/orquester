import {
  buildQueryString,
  type Transporter,
  type TransportRequest,
  type TransportResponse
} from "@orquester/ui";

/** Shape exchanged with the Electron main process over IPC. */
export interface DesktopBridgeRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DesktopBridgeResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

export type DesktopRequestFn = (request: DesktopBridgeRequest) => Promise<DesktopBridgeResponse>;

/**
 * Transporter for the desktop runtime. The renderer cannot open a unix socket
 * directly, so requests are forwarded over the Electron IPC bridge to the main
 * process, which performs the actual HTTP-over-unix-socket call to the daemon.
 */
export class UnixSocketTransporter implements Transporter {
  readonly kind = "unix";

  constructor(private readonly send: DesktopRequestFn) {}

  async request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>> {
    const headers: Record<string, string> = { ...req.headers };
    let body: string | undefined;

    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const response = await this.send({
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
}
