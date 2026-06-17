const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orquesterDesktop", {
  runtime: "desktop",
  dataDir: process.env.ORQUESTER_DATA_DIR,
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
  // Remote-server persistence (<appdir>/app/remotes.json).
  readRemotes: () => ipcRenderer.invoke("orquester:remotes:read"),
  writeRemotes: (remotes) => ipcRenderer.invoke("orquester:remotes:write", remotes),
  // Frameless window caption controls.
  windowControls: {
    minimize: () => ipcRenderer.send("orquester:window", "minimize"),
    toggleMaximize: () => ipcRenderer.send("orquester:window", "toggleMaximize"),
    close: () => ipcRenderer.send("orquester:window", "close")
  }
});
