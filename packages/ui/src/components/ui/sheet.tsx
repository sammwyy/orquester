import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { DropdownContext } from "./dropdown";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Mobile bottom sheet: slides up from the bottom, full-width, large touch
 * targets, respects the safe-area inset. Provides DropdownContext so the same
 * DropdownItem/Label/Separator render here as in a desktop dropdown.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({ open, onClose, title, children }) => {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex flex-col justify-end overflow-hidden rounded-[var(--window-radius)]"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "relative max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-neutral-800 bg-neutral-900",
          "pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl"
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
