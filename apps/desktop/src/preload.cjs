const { contextBridge, ipcRenderer } = require("electron");
const clientVersion = process.argv.find((argument) => argument.startsWith("--orquester-client-version="))?.split("=", 2)[1] ?? "0.0.0";

contextBridge.exposeInMainWorld("orquesterDesktop", {
  runtime: "desktop",
  clientVersion,
  socketPath: process.env.ORQUESTER_UNIX_SOCKET,
  defaultConnection: {
    id: "local",
    name: "Local daemon",
    kind: "local",
    endpoint: `unix://${process.env.ORQUESTER_UNIX_SOCKET}`,
    status: "connected"
  },
  // Byte transport for the renderer's UnixSocketTransporter.
  request: (request) => ipcRenderer.invoke("orquester:request", request),
  openExternal: (url) => ipcRenderer.invoke("orquester:open-external", url),
  workerStatus: () => ipcRenderer.invoke("orquester:worker:status"),
  installWorker: () => ipcRenderer.invoke("orquester:worker:install"),
  configureWorker: (input) => ipcRenderer.invoke("orquester:worker:configure", input),
  setWorkerServiceEnabled: (enabled) => ipcRenderer.invoke("orquester:worker:set-service-enabled", enabled),
  chooseWorkerWorkspaces: () => ipcRenderer.invoke("orquester:worker:choose-workspaces"),
  startWorker: () => ipcRenderer.invoke("orquester:worker:start"),
  stopWorker: () => ipcRenderer.invoke("orquester:worker:stop"),
  restartWorker: () => ipcRenderer.invoke("orquester:worker:restart"),
  workerServiceStatus: () => ipcRenderer.invoke("orquester:worker:service-status"),
  loadAppConfig: () => ipcRenderer.invoke("orquester:config:load"),
  saveAppConfig: (patch) => ipcRenderer.invoke("orquester:config:save", patch),
  loadRemotes: () => ipcRenderer.invoke("orquester:remotes:load"),
  saveRemotes: (remotes) => ipcRenderer.invoke("orquester:remotes:save", remotes),
  // Chunked streaming (session output, event bus). The renderer supplies the id.
  streamOpen: (streamId, path) => ipcRenderer.send("orquester:stream:open", { streamId, path }),
  streamClose: (streamId) => ipcRenderer.send("orquester:stream:close", streamId),
  onStreamData: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("orquester:stream:data", listener);
    return () => ipcRenderer.removeListener("orquester:stream:data", listener);
  },
  onStreamEnd: (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on("orquester:stream:end", listener);
    return () => ipcRenderer.removeListener("orquester:stream:end", listener);
  },
  // Frameless window caption controls.
  windowControls: {
    minimize: () => ipcRenderer.send("orquester:window", "minimize"),
    toggleMaximize: () => ipcRenderer.send("orquester:window", "toggleMaximize"),
    close: () => ipcRenderer.send("orquester:window", "close"),
    setBackdrop: (enabled) => ipcRenderer.send("orquester:window:backdrop", enabled),
    capabilities: () => ipcRenderer.invoke("orquester:window:capabilities"),
    // Linux gets no native rounding: the window is transparent and the UI
    // draws the corners itself (squared off while maximized/fullscreen).
    cssRoundedCorners: process.platform === "linux",
    onStateChange: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on("orquester:window:state", listener);
      return () => ipcRenderer.removeListener("orquester:window:state", listener);
    }
  }
});
