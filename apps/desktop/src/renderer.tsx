import {
  OrquesterApp,
  type ConnectionsAdapter,
  type RemoteConnectionConfig,
  type UiConnection,
  type WindowControls
} from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { UnixSocketTransporter, type DesktopBridge } from "./transport/unix-socket-transporter";

const desktopBridge = window.orquesterDesktop;
const transporter = new UnixSocketTransporter(desktopBridge);

const connectionsAdapter: ConnectionsAdapter = {
  load: () => desktopBridge.readRemotes(),
  save: (remotes) => desktopBridge.writeRemotes(remotes)
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrquesterApp
      runtime="desktop"
      useTitlebar
      initialConnection={desktopBridge.defaultConnection}
      transporter={transporter}
      connectionsAdapter={connectionsAdapter}
      windowControls={desktopBridge.windowControls}
    />
  </React.StrictMode>
);

declare global {
  interface Window {
    orquesterDesktop: DesktopBridge & {
      runtime: "desktop";
      dataDir?: string;
      socketPath?: string;
      defaultConnection: UiConnection;
      windowControls: WindowControls;
      readRemotes: () => Promise<RemoteConnectionConfig[]>;
      writeRemotes: (remotes: RemoteConnectionConfig[]) => Promise<void>;
    };
  }
}
