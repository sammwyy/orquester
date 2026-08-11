import React from "react";
import { cn } from "../../lib/cn";
import { useGlassChrome, useRoundedWindow, useViewportHeight } from "../../hooks";

export interface AppWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Outermost shell of the app. Sized to the *visual* viewport height so the
 * layout always sits above the on-screen keyboard (no overlay, no scroll
 * jumps); sets the monochrome base palette and disables text selection so the
 * chrome behaves like native UI.
 */
export const AppWrapper: React.FC<AppWrapperProps> = ({ children, className }) => {
  const height = useViewportHeight();
  const rounded = useRoundedWindow();
  const glass = useGlassChrome();
  return (
    <div
      style={{ height: height || undefined }}
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden text-neutral-200",
        // Glass: the shell paints nothing so the sidebar can show the desktop;
        // every other region opts back into an opaque background.
        glass ? "bg-transparent" : "bg-neutral-950",
        "select-none antialiased",
        // Frameless windows on platforms without native rounding: the shell
        // makes the surface transparent and the corners are drawn here.
        rounded && "rounded-xl ring-1 ring-inset ring-white/10",
        className
      )}
    >
      {children}
    </div>
  );
};
