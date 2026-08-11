import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

/** Centered modal dialog rendered in a portal; closes on backdrop click / Escape. */
export const Modal: React.FC<ModalProps> = ({ open, onClose, children, className }) => {
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
      className="app-no-drag fixed inset-0 z-[100] flex items-center justify-center overflow-hidden rounded-[var(--window-radius)] bg-black/60 p-3 sm:p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl",
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
    className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
  >
    <X size={16} />
  </button>
);
