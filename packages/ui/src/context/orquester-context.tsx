import React, { createContext, useContext, useMemo } from "react";
import type { ApiClient } from "../lib/api-client";
import type { Runtime } from "../types";

/**
 * Optional bridge the desktop shell exposes (via Electron preload) to control
 * the frameless native window. Absent in the web runtime.
 */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

export interface OrquesterContextValue {
  runtime: Runtime;
  api: ApiClient;
  /** Render a custom titlebar (frameless window). */
  useTitlebar: boolean;
  windowControls?: WindowControls;
}

const OrquesterContext = createContext<OrquesterContextValue | null>(null);

export interface OrquesterProviderProps extends OrquesterContextValue {
  children: React.ReactNode;
}

export const OrquesterProvider: React.FC<OrquesterProviderProps> = ({ children, ...value }) => {
  const memo = useMemo(
    () => value,
    [value.runtime, value.api, value.useTitlebar, value.windowControls]
  );

  return <OrquesterContext.Provider value={memo}>{children}</OrquesterContext.Provider>;
};

export function useOrquester(): OrquesterContextValue {
  const ctx = useContext(OrquesterContext);
  if (!ctx) {
    throw new Error("useOrquester must be used within an <OrquesterApp>");
  }
  return ctx;
}

/** Convenience accessor for the server manager. */
export function useApi(): ApiClient {
  return useOrquester().api;
}
