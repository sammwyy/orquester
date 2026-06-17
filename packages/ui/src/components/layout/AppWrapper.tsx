import React from "react";
import { cn } from "../../lib/cn";

export interface AppWrapperProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Outermost shell of the app. Fills the (frameless) window, sets the
 * monochrome base palette, and disables text selection so the chrome behaves
 * like native UI. The custom titlebar lives inside the top bar, gated by the
 * `useTitlebar` flag passed to <OrquesterApp>.
 */
export const AppWrapper: React.FC<AppWrapperProps> = ({ children, className }) => (
  <div
    className={cn(
      "flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-200",
      "select-none antialiased",
      className
    )}
  >
    {children}
  </div>
);
