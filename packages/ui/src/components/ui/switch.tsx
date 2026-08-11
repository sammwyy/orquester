import React from "react";
import { cn } from "../../lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",
      "disabled:opacity-40",
      checked ? "bg-neutral-200" : "bg-neutral-700"
    )}
  >
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 transform rounded-full bg-neutral-950 shadow-sm shadow-black/40",
        "transition-transform duration-150 ease-out",
        checked ? "translate-x-[18px]" : "translate-x-[3px]"
      )}
    />
  </button>
);
