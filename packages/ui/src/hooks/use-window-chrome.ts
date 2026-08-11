import { useEffect, useState } from "react";
import { useOrquester, type WindowState } from "../context/orquester-context";
import { useAppStore } from "../store/app";

const DETACHED: WindowState = { maximized: false, fullScreen: false };

/** Live native window state; always detached defaults in the web runtime. */
export function useWindowState(): WindowState {
  const { windowControls } = useOrquester();
  const [state, setState] = useState<WindowState>(DETACHED);

  useEffect(() => windowControls?.onStateChange?.(setState), [windowControls]);

  return state;
}

/**
 * Whether the app shell should draw its own rounded corners: only when the
 * platform doesn't round frameless windows itself, and only while the window
 * actually floats (a maximized or fullscreen window must stay square).
 */
export function useRoundedWindow(): boolean {
  const { windowControls } = useOrquester();
  const { maximized, fullScreen } = useWindowState();

  return Boolean(windowControls?.cssRoundedCorners) && !maximized && !fullScreen;
}

/**
 * Whether the sidebar renders translucent over the desktop. Desktop-only
 * (inside a browser tab there is nothing behind the page), and only where the
 * system can blur behind the window — plain transparency is not the effect.
 */
export function useGlassChrome(): boolean {
  const { runtime } = useOrquester();
  const glass = useAppStore((s) => s.appConfig.glassSidebar);
  const strategy = useAppStore((s) => s.blurStrategy);

  return glass && strategy !== null && runtime === "desktop";
}
