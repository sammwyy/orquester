import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Extra classes for the backdrop only (used by the draggable onboarding). */
  backdropClassName?: string;
  /** Make the backdrop a native window drag region while keeping the panel interactive. */
  backdropDraggable?: boolean;
}

/** Matches the CSS `-out` animation durations below — the DOM lingers this long after `open` goes false. */
const CLOSE_MS = 150;

/**
 * Centered modal dialog rendered in a portal; closes on backdrop click / Escape.
 * Stays mounted for one beat after `open` goes false so the closing animation
 * (the reverse of the opening one) gets to play instead of just vanishing.
 */
export const Modal: React.FC<ModalProps> = ({ open, onClose, children, className, backdropClassName, backdropDraggable = false }) => {
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
      className={cn(
        backdropDraggable ? "app-drag" : "app-no-drag",
        "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden rounded-[var(--window-radius)] bg-black/50 p-3 backdrop-blur-sm sm:p-6",
        backdropClassName,
        closing ? "animate-overlay-out" : "animate-overlay-in"
      )}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-800/70",
          "app-no-drag bg-neutral-900/95 shadow-2xl shadow-black/50 backdrop-blur-2xl",
          closing ? "animate-panel-out" : "animate-panel-in",
          className
        )}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export const ModalCloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <button
    type="button"
    aria-label="Close"
    onClick={onClose}
    className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
  >
    <X size={16} />
  </button>
);
