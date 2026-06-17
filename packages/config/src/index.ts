import { z } from "zod";

export const ORQUESTER_DIR_NAME = ".orquester";
export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 47831;
export const LOCAL_CONNECTION_ID = "local";

export type RuntimePlatform = "win32" | "darwin" | "linux" | string;

/** POSIX-style join used for config locations (keeps `/` separators). */
export function joinPath(...segments: string[]): string {
  const filtered = segments.filter(Boolean);
  if (filtered.length === 0) {
    return "";
  }

  const [first, ...rest] = filtered;
  return [
    first.replace(/[\\/]+$/, ""),
    ...rest.map((segment) => segment.replace(/^[\\/]+/, "").replace(/[\\/]+$/, ""))
  ].join("/");
}

// ---------------------------------------------------------------------------
// Directory layout
//
//   ~/.orquester/
//     app/     app.json, remotes.json, logs/<yyyy-mm-dd>.log
//     daemon/  daemon.json, daemon.sock, logs/<yyyy-mm-dd>.log
//
// Workspaces live OUTSIDE .orquester (default ~/workspaces).
// ---------------------------------------------------------------------------

export function orquesterDir(homeDir: string): string {
  return joinPath(homeDir, ORQUESTER_DIR_NAME);
}

export function appDir(homeDir: string): string {
  return joinPath(orquesterDir(homeDir), "app");
}

export function daemonDir(homeDir: string): string {
  return joinPath(orquesterDir(homeDir), "daemon");
}

export function appLogsDir(homeDir: string): string {
  return joinPath(appDir(homeDir), "logs");
}

export function daemonLogsDir(homeDir: string): string {
  return joinPath(daemonDir(homeDir), "logs");
}

export function appConfigPath(homeDir: string): string {
  return joinPath(appDir(homeDir), "app.json");
}

export function remotesConfigPath(homeDir: string): string {
  return joinPath(appDir(homeDir), "remotes.json");
}

export function daemonConfigPath(homeDir: string): string {
  return joinPath(daemonDir(homeDir), "daemon.json");
}

export function defaultWorkspacesDir(homeDir: string): string {
  return joinPath(homeDir, "workspaces");
}

export function defaultSocketPath(homeDir: string, platform: RuntimePlatform): string {
  if (platform === "win32") {
    return "\\\\.\\pipe\\orquester-daemon";
  }

  return joinPath(daemonDir(homeDir), "daemon.sock");
}

/** `yyyy-mm-dd` in local time. */
export function localDateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyLogFile(logsDir: string, date = new Date()): string {
  return joinPath(logsDir, `${localDateStamp(date)}.log`);
}

// ---------------------------------------------------------------------------
// daemon.json
// ---------------------------------------------------------------------------

export const httpTransportSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().min(1).default(DEFAULT_HTTP_HOST),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),
  password: z.string().min(8).optional()
});

export const daemonConfigSchema = z.object({
  version: z.literal(1).default(1),
  workspacesDir: z.string().min(1),
  logsDir: z.string().min(1),
  // Only the external HTTP transport is configurable here; the local unix
  // socket is always present and resolved at runtime (see resolveDaemonPaths).
  transports: z
    .object({
      http: httpTransportSchema.default({ enabled: false })
    })
    .default({ http: { enabled: false } })
});

export type DaemonConfig = z.infer<typeof daemonConfigSchema>;
export type HttpTransportConfig = z.infer<typeof httpTransportSchema>;

/** Runtime-only daemon paths resolved from home/platform/env (not persisted). */
export interface DaemonPaths {
  homeDir: string;
  daemonDir: string;
  configPath: string;
  socketPath: string;
  logsDir: string;
  workspacesDir: string;
}

export function resolveDaemonPaths(input: {
  homeDir: string;
  platform: RuntimePlatform;
  env?: Record<string, string | undefined>;
}): DaemonPaths {
  const env = input.env ?? {};
  return {
    homeDir: input.homeDir,
    daemonDir: daemonDir(input.homeDir),
    configPath: env.ORQUESTER_DAEMON_CONFIG ?? daemonConfigPath(input.homeDir),
    socketPath: env.ORQUESTER_UNIX_SOCKET ?? defaultSocketPath(input.homeDir, input.platform),
    logsDir: env.ORQUESTER_LOGS_DIR ?? daemonLogsDir(input.homeDir),
    workspacesDir: env.ORQUESTER_WORKSPACES_DIR ?? defaultWorkspacesDir(input.homeDir)
  };
}

export function createDefaultDaemonConfig(input: {
  homeDir: string;
  platform: RuntimePlatform;
  env?: Record<string, string | undefined>;
  paths?: DaemonPaths;
}): DaemonConfig {
  const env = input.env ?? {};
  const paths = input.paths ?? resolveDaemonPaths(input);

  return parseDaemonConfig({
    version: 1,
    workspacesDir: paths.workspacesDir,
    logsDir: paths.logsDir,
    transports: {
      http: {
        enabled: env.ORQUESTER_HTTP_ENABLED === "true",
        host: env.ORQUESTER_HTTP_HOST ?? DEFAULT_HTTP_HOST,
        port: env.ORQUESTER_HTTP_PORT ?? String(DEFAULT_HTTP_PORT),
        password: env.ORQUESTER_HTTP_PASSWORD
      }
    }
  });
}

export function parseDaemonConfig(value: unknown): DaemonConfig {
  return daemonConfigSchema.parse(value);
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

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

export type LocalConnectionConfig = z.infer<typeof localConnectionSchema>;
export type RemoteConnectionConfig = z.infer<typeof remoteConnectionSchema>;

export function createLocalConnection(socketPath: string): LocalConnectionConfig {
  return { id: LOCAL_CONNECTION_ID, name: "Local daemon", kind: "local", socketPath };
}

// ---------------------------------------------------------------------------
// app.json (desktop app config)
// ---------------------------------------------------------------------------

export const appConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Connection opened on launch. "local" is always available. */
  activeConnectionId: z.string().min(1).default(LOCAL_CONNECTION_ID),
  /** Render the custom frameless titlebar with window controls. */
  useTitlebar: z.boolean().default(true)
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function createDefaultAppConfig(): AppConfig {
  return appConfigSchema.parse({});
}

export function parseAppConfig(value: unknown): AppConfig {
  return appConfigSchema.parse(value);
}

// ---------------------------------------------------------------------------
// remotes.json (user-added remote servers; local is implicit)
// ---------------------------------------------------------------------------

export const remotesConfigSchema = z.object({
  version: z.literal(1).default(1),
  remotes: z.array(remoteConnectionSchema).default([])
});

export type RemotesConfig = z.infer<typeof remotesConfigSchema>;

export function createDefaultRemotesConfig(): RemotesConfig {
  return remotesConfigSchema.parse({ remotes: [] });
}

export function parseRemotesConfig(value: unknown): RemotesConfig {
  return remotesConfigSchema.parse(value);
}

// ---------------------------------------------------------------------------
// ClientConfig — what the daemon reports about how to reach itself.
// ---------------------------------------------------------------------------

export const clientConfigSchema = z.object({
  version: z.literal(1).default(1),
  activeConnectionId: z.string().min(1).optional(),
  connections: z
    .array(z.discriminatedUnion("kind", [localConnectionSchema, remoteConnectionSchema]))
    .default([])
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type ConnectionConfig = ClientConfig["connections"][number];

export function createDefaultClientConfig(socketPath: string): ClientConfig {
  return parseClientConfig({
    version: 1,
    activeConnectionId: LOCAL_CONNECTION_ID,
    connections: [createLocalConnection(socketPath)]
  });
}

export function parseClientConfig(value: unknown): ClientConfig {
  return clientConfigSchema.parse(value);
}
