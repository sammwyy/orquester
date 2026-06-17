import {
  buildQueryString,
  type Transporter,
  type TransportRequest,
  type TransportResponse
} from "../transporter";
import { FetchHttpClient, type HttpClient } from "../http-client";

export interface HttpTransporterOptions {
  baseUrl: string;
  /** Bearer token sent as `Authorization: Bearer <password>` when present. */
  password?: string;
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
  private readonly client: HttpClient;

  constructor(options: HttpTransporterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.password = options.password;
    this.client = options.httpClient ?? new FetchHttpClient();
  }

  async request<T = unknown>(req: TransportRequest): Promise<TransportResponse<T>> {
    const url = `${this.baseUrl}${req.path}${buildQueryString(req.query)}`;
    const headers: Record<string, string> = { ...req.headers };

    if (this.password) {
      headers.Authorization = `Bearer ${this.password}`;
    }

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
}
