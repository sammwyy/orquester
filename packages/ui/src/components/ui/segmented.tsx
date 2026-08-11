import React from "react";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Stretch each segment to fill the available width. */
  block?: boolean;
  className?: string;
}

/** Inline switch between a few mutually exclusive options. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  block,
  className
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex gap-0.5 rounded-lg bg-neutral-800/60 p-0.5 text-xs",
        block && "flex w-full",
        className
      )}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-3 py-1 transition-colors",
              block && "flex-1",
              selected
                ? "bg-neutral-700 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
