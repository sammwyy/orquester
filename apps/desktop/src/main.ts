import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray, type IpcMainEvent } from "electron";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";

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

function listenForDaemonShutdown(): void {
  if (!daemonSocketPath) return;
  const req = http.request({ socketPath: daemonSocketPath, path: "/events", method: "GET" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      if (chunk.includes('"daemon.shutdown"')) {
        quitting = true;
        app.quit();
      }
    });
    res.on("end", () => {
      if (!quitting && !isDaemonOwner) app.quit();
    });
  });
  req.on("error", () => {
    if (!quitting && !isDaemonOwner) app.quit();
  });
  req.end();
}

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

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
const runInBackground = () => readAppConfig().runInBackground === true;
/** Blur only counts when the system actually offers a backend for it. */
const glassSidebar = () => readAppConfig().glassSidebar === true && blurStrategy() !== null;
const sidebarTransparent = () => readAppConfig().sidebarTransparent === true;
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
[OrquesterAcrylic]::Apply([IntPtr]${hwnd}, [bool]::Parse("${enabled}"))
`;
  try {
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true }).on("error", () => undefined);
  } catch {
    /* Composition support is unavailable. */
  }
}

const KWIN_BLUR_PROPERTY = "_KDE_NET_WM_BLUR_BEHIND_REGION";
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
    const region = roundedRegion(
      Math.round(bounds.width * scaleFactor),
      Math.round(bounds.height * scaleFactor),
      rounded ? Math.round(WINDOW_RADIUS * scaleFactor) : 0
    );
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
    const defaults = { version: 1, activeConnectionId: "local", useTitlebar: true, runInBackground: false };
    fs.writeFileSync(appConfigPath, `${JSON.stringify(defaults, null, 2)}\n`);
  }
  const remotesPath = path.join(dir, "remotes.json");
  if (!fs.existsSync(remotesPath)) {
    fs.writeFileSync(remotesPath, `${JSON.stringify({ version: 1, remotes: [] }, null, 2)}\n`);
  }
  fs.appendFileSync(dailyLogFile(logsDir), `${new Date().toISOString()} app: started\n`);
}

/** Debug build unless ORQUESTER_WORKER_PROFILE=release (e.g. for packaged builds). */
function workerBinaryPath(): string {
  const profile = process.env.ORQUESTER_WORKER_PROFILE === "release" ? "release" : "debug";
  const exe = process.platform === "win32" ? "orquester-worker.exe" : "orquester-worker";
  return path.join(repoRoot, "apps", "worker", "target", profile, exe);
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
    ...(process.env.ORQUESTER_HTTP_ENABLED ? {} : { ORQUESTER_HTTP_ENABLED: "false" })
  };

  const binary = workerBinaryPath();
  if (!fs.existsSync(binary)) {
    throw new Error(`Orquester worker binary not found at ${binary}. Run "cargo build" in apps/worker first.`);
  }

  const args = appdir ? ["--appdir", appdir] : [];
  const child = spawn(binary, args, { cwd: repoRoot, env, stdio: "inherit", windowsHide: true });
  workerProcess = child;
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
  if (!workerProcess) {
    return;
  }
  const current = workerProcess;
  workerProcess = undefined;
  current.kill();
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
  ipcMain.on("orquester:window:backdrop", (_event, enabled: boolean) => {
    if (mainWindow) {
      applyBackdrop(mainWindow, enabled);
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

/** A small monochrome PNG generated at runtime (no asset shipping needed). */
function makeTrayIcon(): Electron.NativeImage {
  const size = 16;
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = Math.hypot(x - c, y - c) <= size / 2 - 0.5;
      px[i] = px[i + 1] = px[i + 2] = 0xe5;
      px[i + 3] = inside ? 0xff : 0;
    }
  }
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
  return nativeImage.createFromBuffer(png);
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
  const glass = glassSidebar();
  const translucent = glass || sidebarTransparent();
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
      preload: path.join(desktopRoot, "dist-electron", "preload.cjs")
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
    if (!glassSidebar() || blurStrategy() !== "kwin") {
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
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(desktopRoot, "dist", "index.html"));
  }
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
  ensureAppFiles();
  const socketPath = socketPathFor();

  if (await checkExistingDaemon(socketPath)) {
    daemonSocketPath = socketPath;
    process.env.ORQUESTER_UNIX_SOCKET = socketPath;
    isDaemonOwner = false;
  } else {
    if (process.platform !== "win32" && fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
    await startIntegratedDaemon();
    isDaemonOwner = true;
  }

  listenForDaemonShutdown();
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
