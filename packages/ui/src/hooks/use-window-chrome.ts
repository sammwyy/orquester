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
  const rounded = useAppStore((s) => s.appConfig.roundedWindow);
  const { maximized, fullScreen } = useWindowState();

  return rounded && Boolean(windowControls?.cssRoundedCorners) && !maximized && !fullScreen;
}

export interface ChromeSurface {
  /** The shell stops painting so the sidebar can show the desktop. */
  transparent: boolean;
  /** The compositor blurs what shows through. */
  blurred: boolean;
  /** Alpha the sidebar surface is drawn with. */
  alpha: number;
  /** Whether the main chrome surface can show the desktop through. */
  chromeTransparent: boolean;
  /** Whether the main chrome surface should use native/compositor blur. */
  chromeBlurred: boolean;
  /** Alpha the main chrome surface is drawn with. */
  chromeAlpha: number;
}

/**
 * How the sidebar surface should be painted. Transparency and blur are asked
 * for separately and each needs the window to support it — inside a browser tab
 * neither is possible, since there is nothing behind the page.
 */
export function useChromeSurface(): ChromeSurface {
  const { runtime } = useOrquester();
  const wantsBlur = useAppStore((s) => s.appConfig.glassSidebar);
  const opacity = useAppStore((s) => s.appConfig.sidebarOpacity);
  const wantsChromeBlur = useAppStore((s) => s.appConfig.glassTitlebar);
  const chromeOpacity = useAppStore((s) => s.appConfig.titlebarOpacity);
  const capabilities = useAppStore((s) => s.windowCapabilities);

  const transparent = runtime === "desktop" && capabilities.transparency && opacity < 1;

  return {
    transparent,
    blurred: transparent && wantsBlur && capabilities.blur !== null,
    alpha: transparent ? opacity : 1,
    chromeTransparent: runtime === "desktop" && capabilities.transparency && chromeOpacity < 1,
    chromeBlurred:
      runtime === "desktop" &&
      capabilities.transparency &&
      chromeOpacity < 1 &&
      wantsChromeBlur &&
      capabilities.blur !== null,
    chromeAlpha: capabilities.transparency ? chromeOpacity : 1
  };
}
