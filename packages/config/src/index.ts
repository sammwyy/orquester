import { z } from "zod";

export const ORQUESTER_DIR_NAME = ".orquester";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 47831;

export type RuntimePlatform = "win32" | "darwin" | "linux" | string;

export const unixSocketTransportSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().min(1).optional()
});

export const httpTransportSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().min(1).default(DEFAULT_HTTP_HOST),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),
  password: z.string().min(8).optional()
});

export const daemonConfigSchema = z.object({
  version: z.literal(1).default(1),
  dataDir: z.string().min(1),
  transports: z.object({
    unixSocket: unixSocketTransportSchema.default({ enabled: true }),
    http: httpTransportSchema.default({ enabled: false })
  }),
  workspacesDir: z.string().min(1),
  logsDir: z.string().min(1)
});

export const localConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal("local"),
  socketPath: z.string().min(1)
});

export const remoteConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal("remote"),
  baseUrl: z.string().url(),
  password: z.string().optional()
});

export const clientConfigSchema = z.object({
  version: z.literal(1).default(1),
  activeConnectionId: z.string().min(1).optional(),
  connections: z.array(z.discriminatedUnion("kind", [localConnectionSchema, remoteConnectionSchema])).default([])
});

export type DaemonConfig = z.infer<typeof daemonConfigSchema>;
export type HttpTransportConfig = z.infer<typeof httpTransportSchema>;
export type UnixSocketTransportConfig = z.infer<typeof unixSocketTransportSchema>;
export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type LocalConnectionConfig = z.infer<typeof localConnectionSchema>;
export type RemoteConnectionConfig = z.infer<typeof remoteConnectionSchema>;
export type ConnectionConfig = ClientConfig["connections"][number];

export function joinConfigPath(...segments: string[]): string {
  const filtered = segments.filter(Boolean);
  if (filtered.length === 0) {
    return "";
  }

  const [first, ...rest] = filtered;
  return [
    first.replace(/[\\/]$/, ""),
    ...rest.map((segment) => segment.replace(/^[\\/]/, "").replace(/[\\/]$/, ""))
  ].join("/");
}

export function defaultDataDir(homeDir: string): string {
  return joinConfigPath(homeDir, ORQUESTER_DIR_NAME);
}

export function defaultSocketPath(dataDir: string, platform: RuntimePlatform): string {
  if (platform === "win32") {
    return "\\\\.\\pipe\\orquester-daemon";
  }

  return joinConfigPath(dataDir, "daemon.sock");
}

export function createDefaultDaemonConfig(input: {
  homeDir: string;
  platform: RuntimePlatform;
  env?: Record<string, string | undefined>;
}): DaemonConfig {
  const dataDir = input.env?.ORQUESTER_DATA_DIR ?? defaultDataDir(input.homeDir);
  const httpEnabled = input.env?.ORQUESTER_HTTP_ENABLED === "true";
  const httpPort = input.env?.ORQUESTER_HTTP_PORT ?? String(DEFAULT_HTTP_PORT);
  const socketPath = input.env?.ORQUESTER_UNIX_SOCKET ?? defaultSocketPath(dataDir, input.platform);

  return parseDaemonConfig({
    version: 1,
    dataDir,
    workspacesDir: joinConfigPath(dataDir, "workspaces"),
    logsDir: joinConfigPath(dataDir, "logs"),
    transports: {
      unixSocket: {
        enabled: input.env?.ORQUESTER_UNIX_SOCKET_ENABLED !== "false",
        path: socketPath
      },
      http: {
        enabled: httpEnabled,
        host: input.env?.ORQUESTER_HTTP_HOST ?? DEFAULT_HTTP_HOST,
        port: httpPort,
        password: input.env?.ORQUESTER_HTTP_PASSWORD
      }
    }
  });
}

export function createDefaultClientConfig(socketPath: string): ClientConfig {
  return parseClientConfig({
    version: 1,
    activeConnectionId: "local",
    connections: [
      {
        id: "local",
        name: "Local daemon",
        kind: "local",
        socketPath
      }
    ]
  });
}

export function parseDaemonConfig(value: unknown): DaemonConfig {
  return daemonConfigSchema.parse(value);
}

export function parseClientConfig(value: unknown): ClientConfig {
  return clientConfigSchema.parse(value);
}
