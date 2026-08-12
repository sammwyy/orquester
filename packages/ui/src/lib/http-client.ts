/**
 * Minimal HTTP client contract. The HTTP transporter depends on this rather
 * than on `fetch` directly, so each runtime can plug in its own client:
 *
 *  - web:     {@link FetchHttpClient} (wraps the browser `fetch`)
 *  - desktop: a custom Node/Electron HTTP client can implement the same shape.
 */

export interface HttpClientRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpClientResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpClient {
  send(req: HttpClientRequest): Promise<HttpClientResponse>;
}

/** HttpClient backed by the platform `fetch`. Used by the web runtime. */
export class FetchHttpClient implements HttpClient {
  private readonly fetchImpl: typeof fetch;

  // Bind to the global so `fetch` keeps its required `this` (a method call like
  // `this.fetchImpl(...)` otherwise throws "Illegal invocation" in browsers).
  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(req: HttpClientRequest): Promise<HttpClientResponse> {
    const doFetch = this.fetchImpl;
    const response = await doFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: req.signal
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      ok: response.ok,
      headers,
      text: () => response.text(),
      arrayBuffer: () => response.arrayBuffer()
    };
  }
}
