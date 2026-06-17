import React from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "default" | "ghost" | "outline";
export type ButtonSize = "sm" | "default" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-neutral-200 text-neutral-900 hover:bg-white",
  ghost: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
  outline: "border border-neutral-700 text-neutral-200 hover:bg-neutral-800"
};

const SIZES: Record<ButtonSize, string> = {
  default: "h-8 px-3 text-sm gap-2",
  sm: "h-7 px-2.5 text-xs gap-1.5",
  icon: "h-7 w-7"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
