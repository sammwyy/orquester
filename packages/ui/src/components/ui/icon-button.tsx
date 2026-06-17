import React from "react";
import { cn } from "../../lib/cn";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/** Square, borderless button for icon-only affordances (toolbar, titlebar). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400",
        "transition-colors hover:bg-neutral-800 hover:text-neutral-100",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500",
        className
      )}
      {...props}
    />
  )
);
IconButton.displayName = "IconButton";
