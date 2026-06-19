import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray, type IpcMainEvent } from "electron";
import { startDaemon as startOrquesterDaemon, type RunningDaemon } from "@orquester/daemon";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";

interface DaemonRequest {
  method?: string;
  path?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: string | Buffer;
}

interface DaemonResponse {
  status: number;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let daemon: RunningDaemon | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let daemonSocketPath: string | undefined;
let quitting = false;

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

async function startIntegratedDaemon(): Promise<void> {
  const socketPath = socketPathFor();
  const webDir = path.join(repoRoot, "apps", "web", "dist");
  const env = {
    ...process.env,
    ORQUESTER_UNIX_SOCKET: socketPath,
    ORQUESTER_WEB_DIR: webDir,
    ...(process.env.ORQUESTER_HTTP_ENABLED ? {} : { ORQUESTER_HTTP_ENABLED: "false" })
  };

  daemon = await startOrquesterDaemon({
    cwd: repoRoot,
    env,
    appdir: process.env.ORQUESTER_APPDIR ? baseDir() : undefined,
    webDir
  });

  process.env.ORQUESTER_UNIX_SOCKET = daemon.socketPath;
  daemonSocketPath = daemon.socketPath;
}

async function stopIntegratedDaemon(): Promise<void> {
  if (!daemon) {
    return;
  }
  const current = daemon;
  daemon = undefined;
  await current.stop().catch((error) => {
    console.error("Failed to stop Orquester daemon", error);
  });
}

/** HTTP request to the daemon over its unix socket (the renderer's transport). */
function requestOverSocket({ method, path: requestPath, headers, body }: DaemonRequest): Promise<DaemonResponse> {
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
          resolve({ status, ok: status >= 200 && status < 300, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
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
  ipcMain.on("orquester:stream:open", (event, payload: { streamId: string; path: string }) => openStreamOverSocket(event, payload));
  ipcMain.on("orquester:stream:close", (_event, streamId: string) => {
    const req = streams.get(streamId);
    if (req) {
      req.destroy();
      streams.delete(streamId);
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
        label: "Quit daemon",
        click: () => {
          quitting = true;
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
    backgroundColor: "#111111",
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

  // Run-in-background: closing hides the window (daemon + tray keep running).
  mainWindow.on("close", (event) => {
    if (!quitting && runInBackground()) {
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

app.whenReady().then(async () => {
  ensureAppFiles();
  await startIntegratedDaemon();
  registerIpc();
  createTray();
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
  if (!runInBackground() && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  quitting = true;
  if (daemon) {
    event.preventDefault();
    void stopIntegratedDaemon().finally(() => app.quit());
  }
});
