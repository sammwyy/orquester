import {
  buildQueryString,
  type StreamHandle,
  type StreamHandlers,
  type Transporter,
  type TransportRequest,
  type TransportResponse
} from "../transporter";
import { FetchHttpClient, type HttpClient } from "../http-client";

export interface HttpTransporterOptions {
  baseUrl: string;
  /** Bearer token sent as `Authorization: Bearer <password>` when present. */
  password?: string;
  /** Account name sent with the derived bearer credential. */
  username?: string;
  /** Defaults to a {@link FetchHttpClient}. */
  httpClient?: HttpClient;
}

/**
 * Transporter that speaks plain HTTP to a remote daemon. The actual byte
 * transport is delegated to an {@link HttpClient}, so the web app uses
 * `fetch` while the desktop app can inject a custom Node-side client.
 */
export class HttpTransporter implements Transporter {
  readonly kind = "http";

  private readonly baseUrl: string;
  private readonly password?: string;
  private readonly username?: string;
  private readonly client: HttpClient;

  constructor(options: HttpTransporterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.password = options.password;
    this.username = options.username;
    this.client = options.httpClient ?? new FetchHttpClient();
  }

  async request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>> {
    const url = `${this.baseUrl}${req.path}${buildQueryString(req.query)}`;
    const headers: Record<string, string> = { ...req.headers };

    if (this.password) {
      headers.Authorization = `Bearer ${this.password}`;
    }
    if (this.username) headers["X-Orquester-Username"] = this.username;

    let body: string | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.body);
    }

    const response = await this.client.send({
      url,
      method: req.method,
      headers,
      body,
      signal: req.signal
    });

    const raw = await response.text();
    const data = raw ? (JSON.parse(raw) as T) : (undefined as T);

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: response.headers
    };
  }

  async requestBinary(req: TransportRequest): Promise<TransportResponse<Uint8Array>> {
    const url = `${this.baseUrl}${req.path}${buildQueryString(req.query)}`;
    const headers: Record<string, string> = { ...req.headers };
    if (this.password) headers.Authorization = `Bearer ${this.password}`;
    if (this.username) headers["X-Orquester-Username"] = this.username;
    const response = await this.client.send({ url, method: req.method, headers, signal: req.signal });
    return { status: response.status, ok: response.ok, data: new Uint8Array(await response.arrayBuffer()), headers: response.headers };
  }

  openStream(path: string, handlers: StreamHandlers): StreamHandle {
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (this.password) {
      headers.Authorization = `Bearer ${this.password}`;
    }
    if (this.username) headers["X-Orquester-Username"] = this.username;

    fetch(`${this.baseUrl}${path}`, { headers, signal: controller.signal })
      .then((response) => {
        if (!response.body) {
          handlers.onEnd();
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              handlers.onEnd();
              return;
            }
            handlers.onData(decoder.decode(value, { stream: true }));
            return pump();
          });
        return pump();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          handlers.onError?.(error);
        }
        handlers.onEnd();
      });

    return { close: () => controller.abort() };
  }
}
