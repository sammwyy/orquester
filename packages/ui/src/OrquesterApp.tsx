import React, { useEffect, useState } from "react";
import { AppWrapper, AppShell } from "./components/layout";
import { Onboarding } from "./components/onboarding";
import { useTheme } from "./hooks";
import { OrquesterProvider, type WindowControls, type WorkerManager } from "./context/orquester-context";
import { ApiClient } from "./lib/api-client";
import { createTransporter } from "./lib/transporters";
import type { AppConfigAdapter } from "./lib/app-config";
import { useAppStore } from "./store/app";
import type { HttpClient } from "./lib/http-client";
import type { Transporter } from "./lib/transporter";
import type { Runtime, UiConnection } from "./types";
import "./styles/globals.css";

export interface OrquesterAppProps {
  /** Which shell is hosting the UI. */
  runtime: Runtime;
  /** Version of the desktop or web client hosting this UI. */
  clientVersion?: string;
  /** Opens a trusted release URL outside the UI. */
  openExternal?: (url: string) => Promise<boolean>;
  /** Installs and starts a local worker when the host supports it. */
  workerManager?: WorkerManager;
  /** The default/local daemon connection (always present, not removable). */
  initialConnection: UiConnection;
  /** Render a custom (frameless) titlebar. Defaults to true on desktop. */
  useTitlebar?: boolean;
  /** Transport for the local connection (e.g. the desktop unix-socket transporter). */
  transporter?: Transporter;
  /** Custom HTTP client for remote transporters. */
  httpClient?: HttpClient;
  /** Native window controls bridge (desktop only). */
  windowControls?: WindowControls;
  /**
   * App-config persistence. Web passes a localStorage adapter; desktop omits it
   * so app config lives on the daemon (app.json). Remotes always live on the daemon.
   */
  appConfigAdapter?: AppConfigAdapter;
}

export const OrquesterApp: React.FC<OrquesterAppProps> = ({
  runtime,
  clientVersion = "0.0.0",
  openExternal,
  workerManager,
  initialConnection,
  useTitlebar,
  transporter,
  httpClient,
  windowControls,
  appConfigAdapter
}) => {
  // A boot ApiClient so context always has one before the store initializes.
  const [bootApi] = useState(
    () =>
      new ApiClient(
        initialConnection,
        transporter ?? createTransporter(initialConnection, { httpClient })
      )
  );
  const storeApi = useAppStore((s) => s.api);
  const api = storeApi ?? bootApi;

  useTheme();

  const defaultTitlebar = useTitlebar ?? runtime === "desktop";
  // Live values from app config (settings can toggle them).
  const titlebar = useAppStore((s) => s.appConfig.useTitlebar);
  const glassSidebar = useAppStore((s) => s.appConfig.glassSidebar);

  // What the window can do decides which appearance options are offered at all;
  // the native backdrop itself then follows the setting.
  useEffect(() => {
    void windowControls
      ?.capabilities?.()
      .then((capabilities) => useAppStore.getState().setWindowCapabilities(capabilities))
      .catch(() => undefined);
  }, [windowControls]);

  useEffect(() => {
    windowControls?.setBackdrop?.(glassSidebar);
  }, [windowControls, glassSidebar]);

  // Set up connections, then connect (app config + remotes load from the daemon).
  useEffect(() => {
    void useAppStore.getState().initConnections({
      localConnection: initialConnection,
      localTransporter: transporter,
      httpClient,
      appConfigAdapter,
      defaultUseTitlebar: defaultTitlebar
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrquesterProvider
      runtime={runtime}
      api={api}
      clientVersion={clientVersion}
      openExternal={openExternal}
      workerManager={workerManager}
      useTitlebar={titlebar}
      windowControls={windowControls}
    >
      <AppWrapper>
        <AppShell />
        <Onboarding />
      </AppWrapper>
    </OrquesterProvider>
  );
};
