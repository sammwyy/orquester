import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { DropdownContext } from "./dropdown";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/** Matches the CSS `-out` animation durations below — the DOM lingers this long after `open` goes false. */
const CLOSE_MS = 180;

/**
 * Mobile bottom sheet: slides up from the bottom, full-width, large touch
 * targets, respects the safe-area inset. Provides DropdownContext so the same
 * DropdownItem/Label/Separator render here as in a desktop dropdown. Stays
 * mounted for one beat after `open` goes false so it can slide back down
 * instead of just disappearing.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({ open, onClose, title, children }) => {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) {
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, rendered]);

  useEffect(() => {
    if (!rendered || closing) {
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rendered, closing, onClose]);

  if (!rendered) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex flex-col justify-end overflow-hidden rounded-[var(--window-radius)]"
      onMouseDown={onClose}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm",
          closing ? "animate-overlay-out" : "animate-overlay-in"
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "relative w-screen max-w-none max-h-[75vh] self-stretch overflow-y-auto rounded-t-2xl border-t border-neutral-800/70",
          "bg-neutral-900/95 backdrop-blur-2xl",
          "pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/50",
          closing ? "animate-sheet-out" : "animate-sheet-in"
        )}
      >
        <div className="sticky top-0 flex items-center justify-center bg-neutral-900 pb-1 pt-2">
          <span className="h-1 w-9 rounded-full bg-neutral-700" />
        </div>
        {title && (
          <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            {title}
          </p>
        )}
        <div className="px-2 pb-2 text-[15px]">
          <DropdownContext.Provider value={{ close: onClose }}>{children}</DropdownContext.Provider>
        </div>
      </div>
    </div>,
    document.body
  );
};
