import type { UiConnection } from "../../types";
import type { Transporter } from "../transporter";
import type { HttpClient } from "../http-client";
import { HttpTransporter } from "./http-transporter";

export { HttpTransporter, type HttpTransporterOptions } from "./http-transporter";

export interface CreateTransporterOptions {
  /** Custom HTTP client (e.g. the desktop Node client). Web defaults to fetch. */
  httpClient?: HttpClient;
}

/**
 * Build the default transporter for a connection from its endpoint scheme.
 *
 *  - `http(s)://…`  => {@link HttpTransporter}
 *  - `unix://…`     => not buildable here; the desktop runtime must inject its
 *                      own unix-socket transporter via the `transporter` prop.
 */
export function createTransporter(
  connection: UiConnection,
  options: CreateTransporterOptions = {}
): Transporter {
  if (connection.endpoint.startsWith("http://") || connection.endpoint.startsWith("https://")) {
    return new HttpTransporter({
      baseUrl: connection.endpoint,
      password: connection.password,
      httpClient: options.httpClient
    });
  }

  throw new Error(
    `No built-in transporter for endpoint "${connection.endpoint}". ` +
      `Pass a custom Transporter via the OrquesterApp \`transporter\` prop (e.g. a unix-socket transporter).`
  );
}
