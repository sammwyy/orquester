import React, { createContext, useContext, useMemo } from "react";
import type { ApiClient } from "../lib/api-client";
import type { Runtime, WindowCapabilities } from "../types";

/** Live state of the native window, pushed by the desktop shell. */
export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

/**
 * Optional bridge the desktop shell exposes (via Electron preload) to control
 * the frameless native window. Absent in the web runtime.
 */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /**
   * True when the platform does not round frameless windows itself and the
   * renderer has to draw the corners (the shell makes the surface transparent).
   */
  cssRoundedCorners?: boolean;
  /** Subscribe to native window state; returns an unsubscribe. */
  onStateChange?(listener: (state: WindowState) => void): () => void;
  /** Turn the native window backdrop on or off. */
  setBackdrop?(enabled: boolean): void;
  /** What this window can do (transparency, blur backend). */
  capabilities?(): Promise<WindowCapabilities>;
}

export interface OrquesterContextValue {
  runtime: Runtime;
  api: ApiClient;
  /** Version of the app shell rendering this UI. */
  clientVersion: string;
  /** Opens a trusted external URL through the host shell when available. */
  openExternal?: (url: string) => Promise<boolean>;
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
    [value.runtime, value.api, value.clientVersion, value.openExternal, value.useTitlebar, value.windowControls]
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
