import { OrquesterApp, type UiConnection, type WindowControls } from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { UnixSocketTransporter, type DesktopBridge } from "./transport/unix-socket-transporter";

const desktopBridge = window.orquesterDesktop;
const transporter = new UnixSocketTransporter(desktopBridge);

// Desktop persists app config + remotes on the local daemon (app.json /
// remotes.json under the appdir), so no client-side adapters are needed.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OrquesterApp
      runtime="desktop"
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
      socketPath?: string;
      defaultConnection: UiConnection;
      windowControls: WindowControls;
    };
  }
}
