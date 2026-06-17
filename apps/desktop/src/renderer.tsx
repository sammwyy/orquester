import { OrquesterApp, type UiConnection, type WindowControls } from "@orquester/ui";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import {
  UnixSocketTransporter,
  type DesktopBridgeRequest,
  type DesktopBridgeResponse
} from "./transport/unix-socket-transporter";

const desktopBridge = window.orquesterDesktop;
const transporter = new UnixSocketTransporter(desktopBridge.request);

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
    orquesterDesktop: {
      runtime: "desktop";
      dataDir?: string;
      socketPath?: string;
      defaultConnection: UiConnection;
      request: (request: DesktopBridgeRequest) => Promise<DesktopBridgeResponse>;
      windowControls: WindowControls;
    };
  }
}
