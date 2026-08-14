import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray, type IpcMainEvent, type OpenDialogOptions } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";

interface DaemonRequest {
  method?: string;
  path?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string | Buffer;
  binary?: boolean;
}

interface DaemonResponse {
  status: number;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  body: string;
  encoding?: "base64";
}

/**
 * Platforms that don't round frameless windows themselves (macOS and Windows
 * do). Where true, the window surface is transparent and the renderer paints
 * the rounded corners.
 */
const CSS_ROUNDED_CORNERS = process.platform === "linux";

/** Whether the live window surface can show what sits behind it. */
let windowTransparency = false;
let workerProcess: ChildProcess | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let daemonSocketPath: string | undefined;
let isDaemonOwner = false;
let quitting = false;
let pendingWorkerSetup: { startWorkerOnLogin: boolean; remoteAccess: boolean; port: number; username?: string; password?: string; serveWeb: boolean; workspacesDir?: string } | undefined;

function checkExistingDaemon(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32" && !fs.existsSync(socketPath)) {
      resolve(false);
      return;
    }
    const req = http.request(
      { socketPath, path: "/api/config/daemon", method: "GET" },
      (res) => {
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on("error", () => resolve(false));
    req.end();
  });
}

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "logo.png")
    : path.join(desktopRoot, "assets", "logo.png");
}

// Base config dir: ORQUESTER_APPDIR (relative paths resolved against the repo
// root so `.stage` is stable regardless of Electron's cwd), else ~/.orquester.
function baseDir(): string {
  const appdir = process.env.ORQUESTER_APPDIR;
  if (appdir && appdir.length > 0) {
    return path.isAbsolute(appdir) ? appdir : path.resolve(repoRoot, appdir);
  }
  return path.join(app.getPath("home"), ".orquester");
}

const appDir = () => path.join(baseDir(), "app");
const daemonDir = () => path.join(baseDir(), "daemon");

function socketPathFor(): string {
  return process.platform === "win32" ? "\\\\.\\pipe\\orquester-daemon" : path.join(daemonDir(), "daemon.sock");
}

function dailyLogFile(logsDir: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return path.join(logsDir, `${stamp}.log`);
}

/** Read app.json (best effort) for desktop-side flags like runInBackground. */
function readAppConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(appDir(), "app.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeAppConfig(patch: Record<string, unknown>): Record<string, unknown> {
  const config = { ...readAppConfig(), ...patch, version: 1 };
  fs.mkdirSync(appDir(), { recursive: true });
  fs.writeFileSync(path.join(appDir(), "app.json"), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

const remoteWorkerMode = () => process.env.ORQUESTER_REMOTE_WORKER === "1";
const repoWorkerMode = () => !app.isPackaged && process.env.ORQUESTER_USE_RELEASE_WORKER !== "1";

interface InstalledWorker {
  version: string;
  path: string;
}

function installedWorkerFile(): string {
  return path.join(app.getPath("userData"), "workers", "current.json");
}

function readInstalledWorker(): InstalledWorker | null {
  try {
    const installed = JSON.parse(fs.readFileSync(installedWorkerFile(), "utf8")) as InstalledWorker;
    return typeof installed.version === "string" && typeof installed.path === "string" && fs.existsSync(installed.path)
      ? installed
      : null;
  } catch {
    return null;
  }
}

function workerAssetName(version: string): string {
  if (process.arch !== "x64") {
    throw new Error(`No worker artifact is available for ${process.arch}.`);
  }
  const platform = process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : null;
  if (!platform) {
    throw new Error(`No worker artifact is available for ${process.platform}.`);
  }
  return `orquester-worker-${version}-${platform}-x86_64${platform === "windows" ? ".exe" : ""}`;
}

async function installLatestWorker(): Promise<InstalledWorker> {
  const response = await fetch("https://api.github.com/repos/sammwyy/orquester/releases?per_page=100", {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`Could not load worker releases (${response.status}).`);
  const releases = await response.json() as unknown;
  const release = Array.isArray(releases)
    ? releases.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as { tag_name?: unknown; prerelease?: unknown };
      return candidate.prerelease !== true && typeof candidate.tag_name === "string" && candidate.tag_name.startsWith("worker-v");
    }) as { tag_name?: unknown } | undefined
    : undefined;
  const version = typeof release?.tag_name === "string" ? release.tag_name.slice("worker-v".length) : undefined;
  if (!version) throw new Error("No stable worker release is available yet.");

  const asset = workerAssetName(version);
  const baseUrl = `https://github.com/sammwyy/orquester/releases/download/worker-v${encodeURIComponent(version)}/${asset}`;
  const [binaryResponse, checksumResponse] = await Promise.all([fetch(baseUrl), fetch(`${baseUrl}.sha256`)]);
  if (!binaryResponse.ok || !checksumResponse.ok) throw new Error("Could not download the worker release or its checksum.");
  const binary = Buffer.from(await binaryResponse.arrayBuffer());
  const expected = (await checksumResponse.text()).trim().split(/\s+/, 1)[0]?.toLowerCase();
  const actual = crypto.createHash("sha256").update(binary).digest("hex");
  if (!expected || actual !== expected) throw new Error("Worker checksum verification failed.");

  const dir = path.join(app.getPath("userData"), "workers", version);
  const binaryPath = path.join(dir, process.platform === "win32" ? "orquester-worker.exe" : "orquester-worker");
  fs.mkdirSync(dir, { recursive: true });
  const temporary = `${binaryPath}.download`;
  fs.writeFileSync(temporary, binary);
  fs.renameSync(temporary, binaryPath);
  if (process.platform !== "win32") fs.chmodSync(binaryPath, 0o755);
  fs.writeFileSync(installedWorkerFile(), `${JSON.stringify({ version, path: binaryPath }, null, 2)}\n`);
  writeAppConfig({ localWorkerInstalled: true });
  return { version, path: binaryPath };
}
const runInBackground = () => readAppConfig().runInBackground === true;
const sidebarOpacity = () => Number(readAppConfig().sidebarOpacity) || 1;
const titlebarOpacity = () => Number(readAppConfig().titlebarOpacity) || 1;
/** Blur only counts when transparency and a native backend are both active. */
const glassSidebar = () =>
  sidebarOpacity() < 1 && readAppConfig().glassSidebar === true && blurStrategy() !== null;
const glassTitlebar = () =>
  titlebarOpacity() < 1 && readAppConfig().glassTitlebar === true && blurStrategy() !== null;
const glassChrome = () => glassSidebar() || glassTitlebar();
/** Corners are rounded unless the user turned them off (default on). */
const roundedWindow = () => readAppConfig().roundedWindow !== false;

/**
 * How this system can blur what sits behind a window. There is no portable way:
 * each platform exposes exactly one mechanism, or none at all — and without one
 * the glass sidebar is pure transparency, which is worse than an opaque panel,
 * so the UI keeps the setting disabled.
 */
type BlurStrategy = "vibrancy" | "acrylic" | "win10-acrylic" | "kwin";

let detectedStrategy: BlurStrategy | null | undefined;

function blurStrategy(): BlurStrategy | null {
  if (detectedStrategy === undefined) {
    detectedStrategy = detectBlurStrategy();
  }
  return detectedStrategy;
}

function detectBlurStrategy(): BlurStrategy | null {
  if (process.platform === "darwin") {
    return "vibrancy";
  }
  if (process.platform === "win32") {
    const build = windowsBuild();
    if (build >= 22621) return "acrylic";
    return null;
  }
  if (process.platform === "linux") {
    return kwinBlurAvailable() ? "kwin" : null;
  }
  return null;
}

/** Build number out of "10.0.22621" (0 when it can't be read). */
function windowsBuild(): number {
  return Number(os.release().split(".")[2]) || 0;
}

/**
 * KWin is the only Linux compositor that takes blur requests, and only for X11
 * surfaces: Wayland has no such protocol, so a Wayland-native window (Ozone)
 * has nothing to ask.
 */
function kwinBlurAvailable(): boolean {
  const desktop = `${process.env.XDG_CURRENT_DESKTOP ?? ""} ${process.env.XDG_SESSION_DESKTOP ?? ""}`;
  if (!/kde|plasma/i.test(desktop)) {
    return false;
  }
  if (app.commandLine.getSwitchValue("ozone-platform") === "wayland") {
    return false;
  }
  try {
    return spawnSync("which", ["xprop"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** Turn the detected backdrop on or off. A system without one does nothing. */
function applyBackdrop(win: BrowserWindow, enabled: boolean): void {
  switch (blurStrategy()) {
    case "vibrancy":
      win.setVibrancy(enabled ? "sidebar" : null);
      break;
    case "acrylic":
      win.setBackgroundMaterial(enabled ? "acrylic" : "none");
      break;
    case "kwin":
      applyKwinBlur(win, enabled);
      break;
    default:
      break;
  }
}

/** Windows 10 acrylic through an undocumented, best-effort Win32 API. */
function applyWindows10Acrylic(win: BrowserWindow, enabled: boolean): void {
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.readUInt32LE().toString();
  if (!/^\d+$/.test(hwnd)) return;
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OrquesterAcrylic {
  [StructLayout(LayoutKind.Sequential)] public struct AccentPolicy { public int State; public int Flags; public uint Color; public int Animation; }
  [StructLayout(LayoutKind.Sequential)] public struct Data { public int Attribute; public IntPtr Data; public int Size; }
  [DllImport("user32.dll")] public static extern bool SetWindowCompositionAttribute(IntPtr hwnd, ref Data data);
  public static void Apply(IntPtr hwnd, bool enabled) {
    var policy = new AccentPolicy { State = enabled ? 4 : 0, Flags = 2, Color = 0xCC181818, Animation = 0 };
    var ptr = Marshal.AllocHGlobal(Marshal.SizeOf(policy));
    try { Marshal.StructureToPtr(policy, ptr, false); var data = new Data { Attribute = 19, Data = ptr, Size = Marshal.SizeOf(policy) }; SetWindowCompositionAttribute(hwnd, ref data); }
    finally { Marshal.FreeHGlobal(ptr); }
  }
}
'@
[OrquesterAcrylic]::Apply([IntPtr]${hwnd}, $env:ORQUESTER_ACRYLIC_ENABLED -eq "1")
`;
  try {
    // enabled reaches here from an untyped IPC message (see the
    // orquester:window:backdrop handler) — an environment variable, not
    // string interpolation, keeps a crafted non-boolean payload from ever
    // becoming part of the script text itself.
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ORQUESTER_ACRYLIC_ENABLED: enabled ? "1" : "0" }
    }).on("error", () => undefined);
  } catch {
    /* Composition support is unavailable. */
  }
}

const KWIN_BLUR_PROPERTY = "_KDE_NET_WM_BLUR_BEHIND_REGION";
const LINUX_SIDEBAR_WIDTH = 280;
/** Keep in sync with the `--window-radius` the shell draws its corners with. */
const WINDOW_RADIUS = 12;

/** The window's X11 id, or undefined when this isn't an X11/XWayland surface. */
function x11WindowId(win: BrowserWindow): string | undefined {
  try {
    const handle = win.getNativeWindowHandle();
    const value = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
    // Window ids are 32-bit; anything larger is a pointer to some other surface.
    return value > 0n && value <= 0xffffffffn ? value.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * xprop stores at most 64 cardinals, i.e. sixteen x/y/w/h quads, and silently
 * truncates the rest — a truncated region blurs part of the window and leaves
 * raw bands on the rest.
 */
const MAX_REGION_QUADS = 16;

/**
 * A rounded rectangle as x/y/w/h quads: one slab for the straight middle, then
 * a staircase following the corner arc (each step shared by the top and bottom
 * edges). Squaring the corners off instead would leave them blurred — a soft
 * square poking out of a rounded window — and dropping them entirely shows the
 * sharp desktop through the corner of a translucent panel.
 */
function roundedRegion(w: number, h: number, r: number): number[] {
  if (r <= 0) {
    return [0, 0, w, h];
  }
  const steps = Math.min(Math.floor((MAX_REGION_QUADS - 1) / 2), r);
  const rects = [0, r, w, h - 2 * r];
  for (let step = 0; step < steps; step += 1) {
    const top = Math.round((step * r) / steps);
    const bottom = Math.round(((step + 1) * r) / steps);
    // Inset at the middle of the band, so the staircase straddles the arc
    // instead of always falling inside or outside it.
    const dy = r - (top + bottom) / 2;
    const inset = Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy)));
    const width = w - 2 * inset;
    const height = bottom - top;
    rects.push(inset, top, width, height, inset, h - bottom, width, height);
  }
  return rects;
}

/**
 * Ask KWin to blur whatever sits behind the window. This X11 property is the
 * only blur request a Linux app can make, and only KWin honours it (X11 or
 * XWayland) — Wayland has no such protocol, and GNOME/wlroots decide blur
 * themselves. Best effort: without KWin or xprop the sidebar stays clear glass.
 */
function applyKwinBlur(win: BrowserWindow, enabled: boolean): void {
  const id = x11WindowId(win);
  if (!id) {
    return;
  }
  const args = ["-id", id];
  if (enabled) {
    const bounds = win.getBounds();
    const { scaleFactor } = screen.getDisplayNearestPoint(bounds);
    const rounded = roundedWindow() && !win.isMaximized() && !win.isFullScreen();
    const width = Math.round(bounds.width * scaleFactor);
    const height = Math.round(bounds.height * scaleFactor);
    const radius = rounded ? Math.round(WINDOW_RADIUS * scaleFactor) : 0;
    const sidebarWidth = Math.min(width, Math.round(LINUX_SIDEBAR_WIDTH * scaleFactor));
    const sidebar = glassSidebar();
    const chrome = glassTitlebar();
    const region = sidebar && chrome
      ? roundedRegion(width, height, radius)
      : chrome
        ? [sidebarWidth, 0, width - sidebarWidth, height]
        : sidebar
          ? [0, 0, sidebarWidth, height]
          : [];
    args.push("-f", KWIN_BLUR_PROPERTY, "32c", "-set", KWIN_BLUR_PROPERTY, region.join(", "));
  } else {
    args.push("-remove", KWIN_BLUR_PROPERTY);
  }
  try {
    spawn("xprop", args, { stdio: "ignore" }).on("error", () => undefined);
  } catch {
    /* no xprop: nothing to do */
  }
}

function ensureAppFiles(): void {
  const dir = appDir();
  const logsDir = path.join(dir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const appConfigPath = path.join(dir, "app.json");
  if (!fs.existsSync(appConfigPath)) {
    const defaults = {
      version: 1,
      activeConnectionId: "local",
      useTitlebar: true,
      runInBackground: false,
      startWorkerOnLogin: false,
      sidebarOpacity: 0.85,
      glassSidebar: false,
      titlebarOpacity: 0.85,
      glassTitlebar: false,
      roundedWindow: true,
      theme: "mono",
      themeMode: "system",
      quotaResetFormat: "both",
      showQuotaMenu: true,
      searchForUpdates: true,
      updateChannel: "stable",
      setupComplete: false,
      localWorkerInstalled: false
    };
    fs.writeFileSync(appConfigPath, `${JSON.stringify(defaults, null, 2)}\n`);
  }
  const remotesPath = path.join(dir, "remotes.json");
  if (!fs.existsSync(remotesPath)) {
    fs.writeFileSync(remotesPath, `${JSON.stringify({ version: 1, remotes: [] }, null, 2)}\n`);
  }
  fs.appendFileSync(dailyLogFile(logsDir), `${new Date().toISOString()} app: started\n`);
}

/** Development uses the repository build; packaged clients use the installed worker. */
function workerBinaryPath(): string | null {
  if (!repoWorkerMode()) {
    return readInstalledWorker()?.path ?? null;
  }
  const profile = process.env.ORQUESTER_WORKER_PROFILE === "release" ? "release" : "debug";
  const exe = process.platform === "win32" ? "orquester-worker.exe" : "orquester-worker";
  return path.join(repoRoot, "worker", "target", profile, exe);
}

function setWorkerServiceEnabled(enabled: boolean): void {
  const binary = workerBinaryPath();
  if (!binary || !fs.existsSync(binary)) throw new Error("The local worker is not installed.");
  const result = spawnSync(binary, ["service", enabled ? "install" : "uninstall", "--appdir", baseDir()], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || "Could not update worker sign-in startup.");
  }
}

type WorkerServiceAction = "start" | "stop" | "restart" | "status";

function workerServiceCommand(action: WorkerServiceAction): string {
  const binary = workerBinaryPath();
  if (!binary || !fs.existsSync(binary)) throw new Error("The local worker is not installed.");
  const result = spawnSync(binary, ["service", action, "--appdir", baseDir()], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.error?.message || `Could not ${action} the worker service.`);
  }
  return result.stdout ?? "";
}

function workerServiceStatus(): { installed: boolean; running: boolean } {
  try {
    const output = workerServiceCommand("status");
    return { installed: /installed=true/i.test(output), running: /running=true/i.test(output) };
  } catch {
    return { installed: false, running: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the worker answers on its socket, or give up after ~20s. */
async function waitForWorkerReady(socketPath: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await checkExistingDaemon(socketPath)) {
      return;
    }
    await sleep(200);
  }
  throw new Error("Orquester worker did not become ready in time.");
}

async function startIntegratedDaemon(): Promise<void> {
  const socketPath = socketPathFor();
  const webDir = path.join(repoRoot, "apps", "web", "dist");
  const appdir = process.env.ORQUESTER_APPDIR ? baseDir() : undefined;
  const env = {
    ...process.env,
    ORQUESTER_UNIX_SOCKET: socketPath,
    ORQUESTER_WEB_DIR: webDir,
    ...(process.env.ORQUESTER_HTTP_ENABLED ? {} : { ORQUESTER_HTTP_ENABLED: pendingWorkerSetup?.remoteAccess ? "true" : "false" }),
    ...(pendingWorkerSetup?.remoteAccess ? {
      ORQUESTER_HTTP_HOST: "0.0.0.0",
      ORQUESTER_HTTP_PORT: String(pendingWorkerSetup.port),
      ORQUESTER_HTTP_USERNAME: pendingWorkerSetup.username,
      ORQUESTER_HTTP_PASSWORD: pendingWorkerSetup.password,
      ORQUESTER_HTTP_SERVE_WEB: String(pendingWorkerSetup.serveWeb),
      ORQUESTER_WORKSPACES_DIR: pendingWorkerSetup.workspacesDir
    } : {})
  };

  const binary = workerBinaryPath();
  if (!binary || !fs.existsSync(binary)) {
    throw new Error(repoWorkerMode()
      ? "Orquester worker binary not found. Run \"cargo build\" in worker first."
      : "No local worker is installed. Complete local worker setup first.");
  }

  const args = appdir ? ["--appdir", appdir] : [];
  const child = spawn(binary, args, { cwd: repoRoot, env, stdio: "ignore", detached: true, windowsHide: true });
  workerProcess = child;
  child.unref();
  child.on("exit", (code) => {
    if (workerProcess === child) {
      workerProcess = undefined;
      console.error(`Orquester worker exited unexpectedly (code ${code}).`);
    }
  });

  await waitForWorkerReady(socketPath);

  process.env.ORQUESTER_UNIX_SOCKET = socketPath;
  daemonSocketPath = socketPath;
}

async function stopIntegratedDaemon(): Promise<void> {
  const socket = daemonSocketPath ?? socketPathFor();
  if (await checkExistingDaemon(socket)) {
    try {
      await requestOverSocket({ method: "POST", path: "/api/daemon/shutdown" });
    } catch {
      // The daemon can close the socket before the response reaches Electron.
    }
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && await checkExistingDaemon(socket)) await sleep(100);
  workerProcess?.kill();
  workerProcess = undefined;
  daemonSocketPath = undefined;
}

/** HTTP request to the daemon over its unix socket (the renderer's transport). */
function requestOverSocket({ method, path: requestPath, headers, body, binary }: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    if (!daemonSocketPath) {
      reject(new Error("Orquester daemon is not running."));
      return;
    }

    const req = http.request(
      { socketPath: daemonSocketPath, path: requestPath || "/", method: method || "GET", headers: headers || {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(binary ? "base64" : "utf8"),
            ...(binary ? { encoding: "base64" as const } : {})
          });
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function applyWorkerSetup(input: { remoteAccess: boolean; port: number; username?: string; password?: string; serveWeb: boolean; workspacesDir?: string }): Promise<void> {
  if (!daemonSocketPath) return;
  const http = input.remoteAccess
    ? {
        enabled: true,
        host: "0.0.0.0",
        port: input.port,
        username: input.username,
        password: input.password,
        serveWeb: input.serveWeb
      }
    : { enabled: false, serveWeb: false };
  const response = await requestOverSocket({
    method: "PUT",
    path: "/api/config/daemon",
    body: JSON.stringify({
      ...(input.workspacesDir ? { workspacesDir: input.workspacesDir } : {}),
      transports: { http }
    }),
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) {
    throw new Error("Could not apply local worker settings.");
  }
}

const streams = new Map<string, http.ClientRequest>();

function openStreamOverSocket(event: IpcMainEvent, { streamId, path: streamPath }: { streamId: string; path: string }): void {
  if (!daemonSocketPath) {
    if (!event.sender.isDestroyed()) {
      event.sender.send("orquester:stream:end", { streamId });
    }
    return;
  }

  const req = http.request({ socketPath: daemonSocketPath, path: streamPath, method: "GET" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("orquester:stream:data", { streamId, chunk });
      }
    });
    res.on("end", () => {
      streams.delete(streamId);
      if (!event.sender.isDestroyed()) {
        event.sender.send("orquester:stream:end", { streamId });
      }
    });
  });
  req.on("error", () => {
    streams.delete(streamId);
    if (!event.sender.isDestroyed()) {
      event.sender.send("orquester:stream:end", { streamId });
    }
  });
  req.end();
  streams.set(streamId, req);
}

function registerIpc(): void {
  ipcMain.handle("orquester:request", (_event, request: DaemonRequest) => requestOverSocket(request));
  ipcMain.handle("orquester:open-external", async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("orquester:worker:status", async () => ({
    installed: repoWorkerMode() || readInstalledWorker() !== null,
    running: Boolean(workerProcess) || await checkExistingDaemon(socketPathFor()) || workerServiceStatus().running,
    source: repoWorkerMode() ? "repository" : "release"
  }));
  ipcMain.handle("orquester:worker:install", async () => {
    if (remoteWorkerMode()) throw new Error("Local worker installation is disabled by ORQUESTER_REMOTE_WORKER.");
    if (repoWorkerMode()) {
      const binary = workerBinaryPath();
      if (!binary || !fs.existsSync(binary)) throw new Error("Build the worker with cargo before installing it for development.");
      writeAppConfig({ localWorkerInstalled: true });
      return { source: "repository" };
    }
    const installed = await installLatestWorker();
    if (readAppConfig().startWorkerOnLogin === true) setWorkerServiceEnabled(true);
    return { source: "release", version: installed.version };
  });
  ipcMain.handle("orquester:worker:configure", async (_event, input: { startWorkerOnLogin: boolean; remoteAccess: boolean; port: number; username?: string; password?: string; serveWeb: boolean; workspacesDir?: string }) => {
    if (input.remoteAccess && (!input.username?.trim() || !input.password || input.password.length < 8)) {
      throw new Error("Remote access requires a username and a password with at least 8 characters.");
    }
    pendingWorkerSetup = { ...input, port: Number.isInteger(input.port) && input.port > 0 && input.port < 65536 ? input.port : 47831, username: input.username?.trim() };
    await applyWorkerSetup(pendingWorkerSetup);
  });
  ipcMain.handle("orquester:worker:choose-workspaces", async () => {
    const options: OpenDialogOptions = {
      title: "Choose a workspace folder",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("orquester:worker:start", async () => {
    const service = workerServiceStatus();
    if (service.installed && !service.running) {
      workerServiceCommand("start");
      await waitForWorkerReady(socketPathFor());
    } else if (!workerProcess && !await checkExistingDaemon(socketPathFor())) {
      await startIntegratedDaemon();
      isDaemonOwner = true;
      createTray();
    }
    if (pendingWorkerSetup) await applyWorkerSetup(pendingWorkerSetup);
    if (pendingWorkerSetup?.startWorkerOnLogin) setWorkerServiceEnabled(true);
    pendingWorkerSetup = undefined;
    return { socketPath: daemonSocketPath };
  });
  ipcMain.handle("orquester:worker:set-service-enabled", (_event, enabled: boolean) => setWorkerServiceEnabled(enabled === true));
  ipcMain.handle("orquester:worker:service-status", () => workerServiceStatus());
  ipcMain.handle("orquester:worker:stop", async () => {
    const service = workerServiceStatus();
    if (service.installed) workerServiceCommand("stop");
    else await stopIntegratedDaemon();
  });
  ipcMain.handle("orquester:worker:restart", async () => {
    const service = workerServiceStatus();
    if (service.installed) {
      workerServiceCommand("restart");
      await waitForWorkerReady(socketPathFor());
    } else {
      await stopIntegratedDaemon();
      await startIntegratedDaemon();
    }
  });
  ipcMain.handle("orquester:config:load", () => readAppConfig());
  ipcMain.handle("orquester:config:save", (_event, patch: Record<string, unknown>) => writeAppConfig(patch));
  ipcMain.handle("orquester:remotes:load", () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(appDir(), "remotes.json"), "utf8")).remotes ?? [];
    } catch {
      return [];
    }
  });
  ipcMain.handle("orquester:remotes:save", (_event, remotes: unknown[]) => {
    fs.writeFileSync(path.join(appDir(), "remotes.json"), `${JSON.stringify({ version: 1, remotes }, null, 2)}\n`);
  });
  ipcMain.on("orquester:stream:open", (event, payload: { streamId: string; path: string }) => openStreamOverSocket(event, payload));
  ipcMain.on("orquester:stream:close", (_event, streamId: string) => {
    const req = streams.get(streamId);
    if (req) {
      req.destroy();
      streams.delete(streamId);
    }
  });
  ipcMain.handle("orquester:window:capabilities", () => ({
    blur: blurStrategy(),
    transparency: windowTransparency
  }));
  ipcMain.on("orquester:window:backdrop", (_event, enabled: unknown) => {
    if (mainWindow) {
      applyBackdrop(mainWindow, enabled === true);
    }
  });
  ipcMain.on("orquester:window", (_event, action: string) => {
    if (!mainWindow) {
      return;
    }
    if (action === "minimize") mainWindow.minimize();
    else if (action === "toggleMaximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === "close") mainWindow.close();
  });
}

function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// --- Tray (always present; controls daemon independently of the window) ---

function makeTrayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(appIconPath());
}

async function httpEnabled(): Promise<boolean> {
  try {
    const res = await requestOverSocket({ method: "GET", path: "/api/config/daemon" });
    return Boolean(JSON.parse(res.body)?.transports?.http?.enabled);
  } catch {
    return false;
  }
}

async function toggleHttp(): Promise<void> {
  const enabled = await httpEnabled();
  try {
    await requestOverSocket({
      method: "PUT",
      path: "/api/config/daemon",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transports: { http: { enabled: !enabled } } })
    });
  } catch (error) {
    console.error("Tray: toggle HTTP failed", error);
  }
  await rebuildTrayMenu();
}

async function rebuildTrayMenu(): Promise<void> {
  if (!tray) {
    return;
  }
  const enabled = await httpEnabled();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Orquester", click: showWindow },
      { type: "separator" },
      { label: `HTTP transport: ${enabled ? "On" : "Off"}`, click: () => void toggleHttp() },
      { type: "separator" },
      {
        label: "Quit",
        click: async () => {
          quitting = true;
          await requestOverSocket({ method: "POST", path: "/api/daemon/shutdown" }).catch(() => {});
          void stopIntegratedDaemon().finally(() => app.quit());
        }
      }
    ])
  );
}

function createTray(): void {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip("Orquester");
  tray.on("click", showWindow);
  void rebuildTrayMenu();
}

function createWindow(): void {
  // Transparency and blur are separate wishes: the sidebar can be see-through
  // without any blur backend, and blur is only ever visible through a
  // see-through sidebar.
  const glass = glassChrome();
  const translucent = glass || sidebarOpacity() < 1 || titlebarOpacity() < 1;
  // The surface can't be made transparent after creation; the native backdrop
  // (vibrancy/acrylic) can, and is re-applied from the renderer. Windows draws
  // acrylic behind the window itself, over a zero-alpha background.
  const transparent = CSS_ROUNDED_CORNERS || (translucent && process.platform === "darwin");
  const winGlass = glass && blurStrategy() === "acrylic";
  windowTransparency = transparent || winGlass;

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "Orquester",
    icon: appIconPath(),
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    show: false,
    // Linux rounds nothing for us: the surface is transparent and the renderer
    // paints the corners. macOS and Windows round frameless windows natively.
    transparent,
    backgroundColor: transparent || winGlass ? "#00000000" : "#111111",
    vibrancy: glass && blurStrategy() === "vibrancy" ? "sidebar" : undefined,
    backgroundMaterial: winGlass ? "acrylic" : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(desktopRoot, "dist-electron", "preload.cjs"),
      additionalArguments: [`--orquester-client-version=${app.getVersion()}`]
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // KWin's blur region is in window coordinates and follows the corner radius,
  // so it has to be redrawn on every resize and maximize.
  let blurResync: ReturnType<typeof setTimeout> | undefined;
  const resyncBlur = (delay = 150) => {
    if (!glassChrome() || blurStrategy() !== "kwin") {
      return;
    }
    clearTimeout(blurResync);
    blurResync = setTimeout(() => {
      if (mainWindow) {
        applyKwinBlur(mainWindow, true);
      }
    }, delay);
  };
  mainWindow.on("resize", () => resyncBlur());

  // The renderer squares off its corners while maximized/fullscreen.
  const sendState = () => {
    const win = mainWindow;
    if (win) {
      win.webContents.send("orquester:window:state", {
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen()
      });
      resyncBlur();
    }
  };
  mainWindow.on("maximize", sendState);
  mainWindow.on("unmaximize", sendState);
  mainWindow.on("restore", sendState);
  mainWindow.on("enter-full-screen", sendState);
  mainWindow.on("leave-full-screen", sendState);
  mainWindow.webContents.on("did-finish-load", sendState);

  // Run-in-background: closing hides the window (daemon + tray keep running).
  mainWindow.on("close", (event) => {
    if (!quitting && runInBackground() && isDaemonOwner) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  const devUrl = process.env.ORQUESTER_DESKTOP_DEV_URL;
  const loaded = devUrl
    ? mainWindow.loadURL(devUrl)
    : mainWindow.loadFile(path.join(desktopRoot, "dist", "index.html"));
  loaded.catch((error) => console.error("Failed to load the Orquester window", error));
}

// Two instances racing to check/spawn the daemon (checkExistingDaemon /
// startIntegratedDaemon below) would both see no daemon running and both
// spawn one, fighting over the same unix socket/named pipe.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.orquester.desktop");
  }
  ensureAppFiles();
  const socketPath = socketPathFor();
  const installedWorker = repoWorkerMode() ? null : readInstalledWorker();

  if (await checkExistingDaemon(socketPath)) {
    daemonSocketPath = socketPath;
    process.env.ORQUESTER_UNIX_SOCKET = socketPath;
    isDaemonOwner = false;
  } else if (!remoteWorkerMode() && (repoWorkerMode() || installedWorker)) {
    if (process.platform !== "win32" && fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
    try {
      await startIntegratedDaemon();
      isDaemonOwner = true;
    } catch (error) {
      await stopIntegratedDaemon();
      console.error("Failed to start Orquester worker", error);
    }
  } else if (!remoteWorkerMode() && readAppConfig().localWorkerInstalled === true) {
    writeAppConfig({ localWorkerInstalled: false });
  }

  registerIpc();
  if (isDaemonOwner) {
    createTray();
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showWindow();
    }
  });
}).catch((error) => {
  console.error("Failed to start Orquester desktop", error);
  app.quit();
});

app.on("window-all-closed", () => {
  // In background mode the tray keeps the app (and daemon) alive.
  if ((!runInBackground() || !isDaemonOwner) && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  quitting = true;
  if (workerProcess) {
    event.preventDefault();
    void stopIntegratedDaemon().finally(() => app.quit());
  }
});
