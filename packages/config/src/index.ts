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

// Variable expansion
//
// Config string values (paths) may reference:
//   $userhome  the OS home directory
//   $user      the OS username
//   $cwd       the process working directory
//   $appdir    the resolved base config dir (~/.orquester or e.g. ./.stage)

export interface ConfigVars {
  user: string;
  userhome: string;
  cwd: string;
  appdir: string;
}

/** Replace `$userhome`/`$user`/`$cwd`/`$appdir` in a string. */
export function expandVars(value: string, vars: ConfigVars): string {
  // `$userhome` is expanded before `$user` so the longer token wins.
  return value
    .replaceAll("$userhome", vars.userhome)
    .replaceAll("$appdir", vars.appdir)
    .replaceAll("$cwd", vars.cwd)
    .replaceAll("$user", vars.user);
}

// Directory layout
//
//   <appdir>/                 (~/.orquester by default, or e.g. ./.stage)
//     app/     app.json, remotes.json, logs/<yyyy-mm-dd>.log
//     daemon/  daemon.json, daemon.sock, logs/<yyyy-mm-dd>.log
//
// Workspaces live wherever daemon.json `workspacesDir` points (default
// `$userhome/workspaces`; the stage sandbox uses `$appdir/workspaces`).

/** Resolve the base config dir. `appdir` (if given) must already be absolute. */
export function resolveBaseDir(homeDir: string, appdir?: string): string {
  return appdir && appdir.length > 0 ? appdir : joinPath(homeDir, ORQUESTER_DIR_NAME);
}

export function appConfigDir(baseDir: string): string {
  return joinPath(baseDir, "app");
}

export function daemonConfigDir(baseDir: string): string {
  return joinPath(baseDir, "daemon");
}

export function appLogsDir(baseDir: string): string {
  return joinPath(appConfigDir(baseDir), "logs");
}

export function daemonLogsDir(baseDir: string): string {
  return joinPath(daemonConfigDir(baseDir), "logs");
}

export function appConfigPath(baseDir: string): string {
  return joinPath(appConfigDir(baseDir), "app.json");
}

export function remotesConfigPath(baseDir: string): string {
  return joinPath(appConfigDir(baseDir), "remotes.json");
}

export function daemonConfigPath(baseDir: string): string {
  return joinPath(daemonConfigDir(baseDir), "daemon.json");
}

export function defaultSocketPath(baseDir: string, platform: RuntimePlatform): string {
  if (platform === "win32") {
    return "\\\\.\\pipe\\orquester-daemon";
  }

  return joinPath(daemonConfigDir(baseDir), "daemon.sock");
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

// daemon.json

export const httpTransportSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().min(1).default(DEFAULT_HTTP_HOST),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_HTTP_PORT),
  /** Transient plaintext input (env / settings). Migrated to `passwordHash`. */
  password: z.string().min(8).optional(),
  /** bcrypt hash of the password — what's persisted at rest. */
  passwordHash: z.string().optional()
});

export const daemonConfigSchema = z.object({
  version: z.literal(1).default(1),
  // May contain $vars; expand with expandVars() before use.
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

/** Runtime-only daemon paths resolved from home/platform/appdir (not persisted). */
export interface DaemonPaths {
  homeDir: string;
  baseDir: string;
  daemonDir: string;
  configPath: string;
  socketPath: string;
  vars: ConfigVars;
}

export function resolveDaemonPaths(input: {
  homeDir: string;
  platform: RuntimePlatform;
  cwd: string;
  /** Absolute base config dir, or undefined for the default ~/.orquester. */
  appdir?: string;
  env?: Record<string, string | undefined>;
}): DaemonPaths {
  const env = input.env ?? {};
  const baseDir = resolveBaseDir(input.homeDir, input.appdir);
  const user = env.USER ?? env.USERNAME ?? lastSegment(input.homeDir);

  return {
    homeDir: input.homeDir,
    baseDir,
    daemonDir: daemonConfigDir(baseDir),
    configPath: env.ORQUESTER_DAEMON_CONFIG ?? daemonConfigPath(baseDir),
    socketPath: env.ORQUESTER_UNIX_SOCKET ?? defaultSocketPath(baseDir, input.platform),
    vars: { user, userhome: input.homeDir, cwd: input.cwd, appdir: baseDir }
  };
}

export function createDefaultDaemonConfig(input: {
  env?: Record<string, string | undefined>;
}): DaemonConfig {
  const env = input.env ?? {};

  return parseDaemonConfig({
    version: 1,
    workspacesDir: "$userhome/workspaces",
    logsDir: "$appdir/daemon/logs",
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

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

// Connections

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

// app.json (desktop app config)

export const appConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Connection opened on launch. "local" is always available. */
  activeConnectionId: z.string().min(1).default(LOCAL_CONNECTION_ID),
  /** Render the custom frameless titlebar with window controls. */
  useTitlebar: z.boolean().default(true),
  /** Desktop: keep the daemon running in a tray when the window is closed. */
  runInBackground: z.boolean().default(false)
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function createDefaultAppConfig(): AppConfig {
  return appConfigSchema.parse({});
}

export function parseAppConfig(value: unknown): AppConfig {
  return appConfigSchema.parse(value);
}

// remotes.json (user-added remote servers; local is implicit)

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

// ClientConfig — what the daemon reports about how to reach itself.}

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
