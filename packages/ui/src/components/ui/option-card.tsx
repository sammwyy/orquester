import React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export interface OptionCardProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Preview rendered inside the framed area. */
  children: React.ReactNode;
  className?: string;
}

/**
 * A framed preview the user picks from (themes, modes). The selected card gets
 * the ring and a check; the label sits outside the frame.
 */
export const OptionCard: React.FC<OptionCardProps> = ({
  label,
  selected,
  onSelect,
  disabled,
  children,
  className
}) => (
  <button
    type="button"
    aria-pressed={selected}
    disabled={disabled}
    onClick={onSelect}
    className={cn(
      "group flex flex-col items-center gap-1.5 focus:outline-none",
      disabled && "cursor-not-allowed opacity-50",
      className
    )}
  >
    <span
      className={cn(
        "relative block w-full overflow-hidden rounded-xl ring-2 transition-all",
        selected
          ? "ring-neutral-300"
          : "ring-neutral-800 group-hover:ring-neutral-600 group-focus-visible:ring-neutral-600"
      )}
    >
      {children}
      {selected && (
        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-200 text-neutral-900">
          <Check size={11} strokeWidth={3} />
        </span>
      )}
    </span>
    <span
      className={cn(
        "text-[11px] transition-colors",
        selected ? "text-neutral-100" : "text-neutral-400 group-hover:text-neutral-200"
      )}
    >
      {label}
    </span>
  </button>
);
