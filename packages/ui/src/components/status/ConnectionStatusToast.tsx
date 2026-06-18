import React from "react";
import { createPortal } from "react-dom";
import { Loader2, WifiOff } from "lucide-react";
import { useAppStore } from "../../store/app";

/**
 * Floating toast for connection trouble: a spinner + "Reconnecting… attempt N"
 * while the client retries a dropped/restarted transport, or a "Disconnected"
 * card with Retry when it gives up. Hidden during normal startup and while the
 * auth prompt is showing.
 */
export const ConnectionStatusToast: React.FC = () => {
  const status = useAppStore((s) => s.connectionStatus);
  const attempt = useAppStore((s) => s.reconnectAttempt);
  const authPrompt = useAppStore((s) => s.authPrompt);
  const connect = useAppStore((s) => s.connect);

  if (authPrompt) {
    return null;
  }
  const reconnecting = status === "connecting" && attempt > 0;
  const errored = status === "error";
  if (!reconnecting && !errored) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[95] flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-neutral-700 bg-neutral-900/95 py-1.5 pl-3 pr-2 text-sm shadow-xl shadow-black/40 backdrop-blur">
        {reconnecting ? (
          <>
            <Loader2 size={15} className="animate-spin text-neutral-300" />
            <span className="text-neutral-200">Reconnecting…</span>
            <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
              attempt {attempt}
            </span>
          </>
        ) : (
          <>
            <WifiOff size={15} className="text-red-400" />
            <span className="text-neutral-200">Disconnected</span>
            <button
              type="button"
              onClick={() => void connect()}
              className="rounded-full bg-neutral-200 px-3 py-0.5 text-xs font-medium text-neutral-900 hover:bg-white"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
