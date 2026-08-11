import React from "react";
import { cn } from "../../lib/cn";

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

/**
 * Range input with a filled track. The fill is painted with a gradient stop at
 * the current value, so it themes itself like everything else.
 */
export const Slider: React.FC<SliderProps> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  className,
  disabled,
  ...props
}) => {
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{
        background: `linear-gradient(to right, rgb(var(--n-400)) ${percent}%, rgb(var(--n-800)) ${percent}%)`
      }}
      className={cn(
        "ui-slider h-1.5 w-full cursor-pointer appearance-none rounded-full",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
      {...props}
    />
  );
};
