import React from "react";
import { Minus, Square, X } from "lucide-react";
import { useOrquester } from "../../context/orquester-context";

/**
 * Windows-style caption buttons (minimize / maximize / close) for a frameless
 * window. Rendered at the far right of the top bar, only when a custom
 * titlebar is enabled and the desktop shell exposes window controls.
 */
export const WindowControls: React.FC = () => {
  const { windowControls } = useOrquester();

  const buttonClass =
    "app-no-drag inline-flex h-full w-11 items-center justify-center text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100";

  return (
    <div className="ml-1 flex h-full items-stretch self-stretch">
      <button
        type="button"
        aria-label="Minimize"
        className={buttonClass}
        onClick={() => windowControls?.minimize()}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        className={buttonClass}
        onClick={() => windowControls?.toggleMaximize()}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${buttonClass} hover:bg-red-600 hover:text-white`}
        onClick={() => windowControls?.close()}
      >
        <X size={16} />
      </button>
    </div>
  );
};
