import React, { useEffect, useState } from "react";
import { AppWrapper, AppShell } from "./components/layout";
import { OrquesterProvider, type WindowControls } from "./context/orquester-context";
import { ApiClient } from "./lib/api-client";
import { createTransporter } from "./lib/transporters";
import type { ConnectionsAdapter } from "./lib/connections";
import { useAppStore } from "./store/app";
import type { HttpClient } from "./lib/http-client";
import type { Transporter } from "./lib/transporter";
import type { Runtime, UiConnection } from "./types";
import "./styles/globals.css";

export interface OrquesterAppProps {
  /** Which shell is hosting the UI. */
  runtime: Runtime;
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
  /** Persistence for user-added remote servers (desktop IPC / web localStorage). */
  connectionsAdapter?: ConnectionsAdapter;
}

export const OrquesterApp: React.FC<OrquesterAppProps> = ({
  runtime,
  initialConnection,
  useTitlebar,
  transporter,
  httpClient,
  windowControls,
  connectionsAdapter
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

  const titlebar = useTitlebar ?? runtime === "desktop";

  // Set up connections (local + persisted remotes), then connect.
  useEffect(() => {
    void useAppStore.getState().initConnections({
      localConnection: initialConnection,
      localTransporter: transporter,
      httpClient,
      adapter: connectionsAdapter
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OrquesterProvider
      runtime={runtime}
      api={api}
      useTitlebar={titlebar}
      windowControls={windowControls}
    >
      <AppWrapper>
        <AppShell />
      </AppWrapper>
    </OrquesterProvider>
  );
};
