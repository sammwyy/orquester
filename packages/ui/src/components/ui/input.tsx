import React from "react";
import { cn } from "../../lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-sm",
        "text-neutral-100 placeholder:text-neutral-500",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
