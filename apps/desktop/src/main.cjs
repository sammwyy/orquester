const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

let daemonProcess;
let mainWindow;
let daemonSocketPath;

// ~/.orquester/{app,daemon}; keep these in sync with @orquester/config.
function orquesterDir() {
  return path.join(app.getPath("home"), ".orquester");
}

function appDir() {
  return path.join(orquesterDir(), "app");
}

function daemonDir() {
  return path.join(orquesterDir(), "daemon");
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
  const repoRoot = path.resolve(__dirname, "../../..");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  daemonProcess = spawn(pnpm, ["--filter", "@orquester/daemon", "start"], {
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

function registerIpc() {
  ipcMain.handle("orquester:request", (_event, request) => requestOverSocket(request));

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
