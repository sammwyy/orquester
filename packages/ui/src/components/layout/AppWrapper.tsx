import React, { useEffect } from "react";
import { cn } from "../../lib/cn";
import { useChromeSurface, useRoundedWindow, useViewportHeight } from "../../hooks";

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
  const { transparent, alpha } = useChromeSurface();

  // Portalled overlays live outside this element, so the radius travels as a
  // variable instead of a class.
  useEffect(() => {
    document.documentElement.style.setProperty("--window-radius", rounded ? "12px" : "0px");
  }, [rounded]);

  return (
    <div
      style={
        {
          height: height || undefined,
          "--sidebar-alpha": alpha,
          backgroundColor: transparent ? "transparent" : "var(--chrome-background)"
        } as React.CSSProperties
      }
      className={cn(
        "flex h-screen w-screen flex-col overflow-hidden text-neutral-200",
        "select-none antialiased",
        "rounded-[var(--window-radius)]",
        className
      )}
    >
      {children}
    </div>
  );
};
