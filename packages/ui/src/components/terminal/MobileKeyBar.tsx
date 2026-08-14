import React from "react";
import { useApi } from "../../context/orquester-context";
import { useIsDesktop } from "../../hooks";
import { useActiveTabId, useProjectTabs } from "../../store/app";

// Control keys Android/iOS soft keyboards usually lack. Values are the bytes a
// PTY expects.
const KEYS: { label: string; data: string; wide?: boolean }[] = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "⌃C", data: "\x03" },
  { label: "⌃D", data: "\x04" },
  { label: "←", data: "\x1b[D" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "→", data: "\x1b[C" },
  { label: "↵", data: "\r", wide: true }
];

/**
 * Mobile-only toolbar of terminal control keys for the active session. It lives
 * in the layout flow (shrink-0) so it pushes/resizes the terminal rather than
 * overlaying it; since the app shell is sized to the visual viewport, it ends
 * up just above the on-screen keyboard. Sends bytes straight to the daemon
 * session without stealing focus (the keyboard stays open).
 */
export const MobileKeyBar: React.FC = () => {
  const api = useApi();
  const isDesktop = useIsDesktop();
  const tabs = useProjectTabs();
  const activeId = useActiveTabId();

  const active = tabs.find((t) => t.id === activeId);
  if (isDesktop || !active || active.type !== "session") {
    return null;
  }
  const sessionId = active.session.id;

  return (
    <div className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-neutral-800 bg-neutral-900 px-2 py-1.5">
      {KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          // Don't take focus → the keyboard stays up.
          onPointerDown={(e) => {
            e.preventDefault();
            void api.sendSessionInput(sessionId, key.data);
          }}
          className={`flex h-9 shrink-0 items-center justify-center rounded-md bg-neutral-800 px-3 font-mono text-sm text-neutral-200 active:bg-neutral-700 ${key.wide ? "flex-1" : ""}`}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
};
