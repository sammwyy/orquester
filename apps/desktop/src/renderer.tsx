import { OrquesterApp, type AppConfigAdapter, type UiConnection, type WindowControls } from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { UnixSocketTransporter, type DesktopBridge } from "./transport/unix-socket-transporter";

const desktopBridge = window.orquesterDesktop;
const transporter = new UnixSocketTransporter(desktopBridge);
const workerManager = typeof desktopBridge.installWorker === "function"
  && typeof desktopBridge.configureWorker === "function"
  && typeof desktopBridge.setWorkerServiceEnabled === "function"
  && typeof desktopBridge.startWorker === "function"
  && typeof desktopBridge.stopWorker === "function"
  && typeof desktopBridge.restartWorker === "function"
  && typeof desktopBridge.workerServiceStatus === "function"
  && typeof desktopBridge.chooseWorkerWorkspaces === "function"
  ? {
      install: () => desktopBridge.installWorker().then(() => undefined),
      status: () => desktopBridge.workerStatus(),
      configure: (input: { startWorkerOnLogin: boolean; remoteAccess: boolean; port: number; username?: string; password?: string; serveWeb: boolean; workspacesDir?: string }) => desktopBridge.configureWorker(input),
      start: () => desktopBridge.startWorker().then(() => undefined),
      stop: () => desktopBridge.stopWorker(),
      restart: () => desktopBridge.restartWorker(),
      serviceStatus: () => desktopBridge.workerServiceStatus(),
      setServiceEnabled: (enabled: boolean) => desktopBridge.setWorkerServiceEnabled(enabled),
      chooseWorkspacesDirectory: () => desktopBridge.chooseWorkerWorkspaces()
    }
  : undefined;
const appConfigAdapter: AppConfigAdapter = {
  load: () => desktopBridge.loadAppConfig() as ReturnType<AppConfigAdapter["load"]>,
  save: (config) => desktopBridge.saveAppConfig(config).then(() => undefined),
  loadRemotes: () => desktopBridge.loadRemotes() as ReturnType<NonNullable<AppConfigAdapter["loadRemotes"]>>,
  saveRemotes: (remotes) => desktopBridge.saveRemotes(remotes)
};

// Desktop persists app config + remotes on the local daemon (app.json /
// remotes.json under the appdir), so no client-side adapters are needed.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrquesterApp
      runtime="desktop"
      clientVersion={desktopBridge.clientVersion}
      openExternal={desktopBridge.openExternal}
      appConfigAdapter={appConfigAdapter}
      workerManager={workerManager}
      useTitlebar
      initialConnection={desktopBridge.defaultConnection}
      transporter={transporter}
      windowControls={desktopBridge.windowControls}
    />
  </React.StrictMode>
);

declare global {
  interface Window {
    orquesterDesktop: DesktopBridge & {
      runtime: "desktop";
      clientVersion: string;
      socketPath?: string;
      defaultConnection: UiConnection;
      windowControls: WindowControls;
    };
  }
}
