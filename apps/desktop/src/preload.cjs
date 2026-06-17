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
  // Frameless window caption controls.
  windowControls: {
    minimize: () => ipcRenderer.send("orquester:window", "minimize"),
    toggleMaximize: () => ipcRenderer.send("orquester:window", "toggleMaximize"),
    close: () => ipcRenderer.send("orquester:window", "close")
  }
});
