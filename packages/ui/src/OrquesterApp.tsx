import React, { useEffect, useMemo } from "react";
import { AppWrapper, AppShell } from "./components/layout";
import { OrquesterProvider, type WindowControls } from "./context/orquester-context";
import { ApiClient } from "./lib/api-client";
import { createTransporter } from "./lib/transporters";
import { useAppStore } from "./store/app";
import type { HttpClient } from "./lib/http-client";
import type { Transporter } from "./lib/transporter";
import type { Runtime, UiConnection } from "./types";
import "./styles/globals.css";

export interface OrquesterAppProps {
  /** Which shell is hosting the UI. */
  runtime: Runtime;
  /** The default daemon connection (the "server" passed in by the host). */
  initialConnection: UiConnection;
  /**
   * Render a custom (frameless) titlebar with window controls.
   * Defaults to `true` on desktop, `false` on web.
   */
  useTitlebar?: boolean;
  /**
   * Transport to reach the daemon. Inject one for non-HTTP endpoints — e.g.
   * the desktop app passes a unix-domain-socket transporter. When omitted, a
   * default HTTP transporter is built from `initialConnection`.
   */
  transporter?: Transporter;
  /** Custom HTTP client for the default HTTP transporter (e.g. desktop). */
  httpClient?: HttpClient;
  /** Native window controls bridge (desktop only). */
  windowControls?: WindowControls;
}

export const OrquesterApp: React.FC<OrquesterAppProps> = ({
  runtime,
  initialConnection,
  useTitlebar,
  transporter,
  httpClient,
  windowControls
}) => {
  const api = useMemo(() => {
    const transport = transporter ?? createTransporter(initialConnection, { httpClient });
    return new ApiClient(initialConnection, transport);
  }, [initialConnection, transporter, httpClient]);

  const titlebar = useTitlebar ?? runtime === "desktop";

  // Bind the server manager into the store and load the workspace tree.
  useEffect(() => {
    const store = useAppStore.getState();
    store.setApi(api);
    void store.loadWorkspaces();
  }, [api]);

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
