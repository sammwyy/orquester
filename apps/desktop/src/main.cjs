const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

let daemonProcess;
let mainWindow;
let daemonSocketPath;

const repoRoot = path.resolve(__dirname, "../../..");

// Base config dir: ORQUESTER_APPDIR (relative paths resolved against the repo
// root so `.stage` is stable regardless of Electron's cwd), else
// ~/.orquester. Keep these in sync with @orquester/config.
function baseDir() {
  const appdir = process.env.ORQUESTER_APPDIR;
  if (appdir && appdir.length > 0) {
    return path.isAbsolute(appdir) ? appdir : path.resolve(repoRoot, appdir);
  }
  return path.join(app.getPath("home"), ".orquester");
}

function appDir() {
  return path.join(baseDir(), "app");
}

function daemonDir() {
  return path.join(baseDir(), "daemon");
}

function socketPathFor() {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\orquester-daemon";
  }

  return path.join(daemonDir(), "daemon.sock");
}

function dailyLogFile(logsDir) {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  return path.join(logsDir, `${stamp}.log`);
}

/** Create ~/.orquester/app + default app.json / remotes.json and append a log line. */
function ensureAppFiles() {
  const dir = appDir();
  const logsDir = path.join(dir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  const appConfigPath = path.join(dir, "app.json");
  if (!fs.existsSync(appConfigPath)) {
    const defaults = { version: 1, activeConnectionId: "local", useTitlebar: true };
    fs.writeFileSync(appConfigPath, `${JSON.stringify(defaults, null, 2)}\n`);
  }

  const remotesPath = path.join(dir, "remotes.json");
  if (!fs.existsSync(remotesPath)) {
    // The local unix daemon is always present and is NOT listed here.
    fs.writeFileSync(remotesPath, `${JSON.stringify({ version: 1, remotes: [] }, null, 2)}\n`);
  }

  fs.appendFileSync(dailyLogFile(logsDir), `${new Date().toISOString()} app: started\n`);
}

function startDaemon() {
  const socketPath = socketPathFor();
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = ["--filter", "@orquester/daemon", "start"];
  if (process.env.ORQUESTER_APPDIR) {
    // Pass the resolved appdir so the embedded daemon shares this sandbox.
    args.push("--", "--appdir", baseDir());
  }

  daemonProcess = spawn(pnpm, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ORQUESTER_UNIX_SOCKET: socketPath,
      ORQUESTER_HTTP_ENABLED: "false"
    },
    stdio: "inherit"
  });

  daemonProcess.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`Orquester daemon exited with code ${code}`);
    }
  });

  process.env.ORQUESTER_UNIX_SOCKET = socketPath;
  daemonSocketPath = socketPath;
}

/**
 * Perform an HTTP request to the daemon over its unix-domain socket (or
 * Windows named pipe). This is the byte transport behind the renderer's
 * UnixSocketTransporter.
 */
function requestOverSocket({ method, path: requestPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: daemonSocketPath,
        path: requestPath || "/",
        method: method || "GET",
        headers: headers || {}
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
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

// Active chunked streams (session output / event bus) keyed by renderer id.
const streams = new Map();

function openStreamOverSocket(event, { streamId, path }) {
  const req = http.request({ socketPath: daemonSocketPath, path, method: "GET" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
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

function remotesPath() {
  return path.join(appDir(), "remotes.json");
}

function registerIpc() {
  ipcMain.handle("orquester:request", (_event, request) => requestOverSocket(request));

  // Remote-server persistence.
  ipcMain.handle("orquester:remotes:read", () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(remotesPath(), "utf8"));
      return Array.isArray(parsed.remotes) ? parsed.remotes : [];
    } catch {
      return [];
    }
  });
  ipcMain.handle("orquester:remotes:write", (_event, remotes) => {
    try {
      fs.mkdirSync(appDir(), { recursive: true });
      fs.writeFileSync(remotesPath(), `${JSON.stringify({ version: 1, remotes }, null, 2)}\n`);
    } catch {
      /* best effort */
    }
  });

  ipcMain.on("orquester:stream:open", (event, payload) => openStreamOverSocket(event, payload));
  ipcMain.on("orquester:stream:close", (_event, streamId) => {
    const req = streams.get(streamId);
    if (req) {
      req.destroy();
      streams.delete(streamId);
    }
  });

  ipcMain.on("orquester:window", (_event, action) => {
    if (!mainWindow) {
      return;
    }
    if (action === "minimize") {
      mainWindow.minimize();
    } else if (action === "toggleMaximize") {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    } else if (action === "close") {
      mainWindow.close();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: "Orquester",
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  const devUrl = process.env.ORQUESTER_DESKTOP_DEV_URL;

  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  ensureAppFiles();
  startDaemon();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (daemonProcess && !daemonProcess.killed) {
    daemonProcess.kill();
  }
});
