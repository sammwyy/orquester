import React, { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";
import type { SessionSummary } from "../../types";

const FONT_STACK =
  '"JetBrains Mono", "Cascadia Code", "Fira Code", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';

/**
 * xterm paints on a canvas, so it can't use classes: it reads the same theme
 * variables the rest of the app is styled with (see globals.css).
 */
function readTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string) => css.getPropertyValue(`--term-${name}`).trim();
  const background = value("bg");
  const foreground = value("fg");

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: value("selection"),
    black: value("black"),
    red: value("red"),
    green: value("green"),
    yellow: value("yellow"),
    blue: value("blue"),
    magenta: value("magenta"),
    cyan: value("cyan"),
    white: value("white"),
    brightBlack: value("bright-black"),
    brightRed: value("bright-red"),
    brightGreen: value("bright-green"),
    brightYellow: value("bright-yellow"),
    brightBlue: value("bright-blue"),
    brightMagenta: value("bright-magenta"),
    brightCyan: value("bright-cyan"),
    brightWhite: value("bright-white")
  };
}

/**
 * xterm.js view bound to a daemon session. Keystrokes (including control codes
 * like Ctrl-C `\x03`) are forwarded as input; the session's output stream is
 * replayed (current buffer) then streamed live. The PTY lives in the daemon,
 * so unmounting this view does not kill the session.
 */
export const TerminalView: React.FC<{ session: SessionSummary }> = ({ session }) => {
  const api = useApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const scheme = useAppStore((s) => s.appConfig.theme);
  const mode = useAppStore((s) => s.resolvedMode);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: FONT_STACK,
      fontSize: 13,
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 8000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
      macOptionIsMeta: true,
      theme: readTheme()
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // Crisp GPU rendering when available; harmless fallback otherwise.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* keep the default canvas/DOM renderer */
    }

    const applyFit = () => {
      try {
        fit.fit();
      } catch {
        /* container not measurable yet */
      }
      void api.resizeSession(session.id, term.cols, term.rows);
    };
    applyFit();
    term.focus();

    const inputSub = term.onData((data) => {
      void api.sendSessionInput(session.id, data);
    });

    const resizeObserver = new ResizeObserver(() => applyFit());
    resizeObserver.observe(container);

    const stream = api.openSessionOutput(session.id, {
      onData: (chunk) => term.write(chunk),
      onEnd: () => term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n")
    });

    return () => {
      stream.close();
      inputSub.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [api, session.id]);

  // Re-read the palette when the theme changes; the session keeps streaming.
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = readTheme();
    }
  }, [scheme, mode]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-neutral-950 p-2" />;
};
