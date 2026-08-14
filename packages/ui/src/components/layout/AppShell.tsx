import React from "react";
import { Sidebar } from "../sidebar";
import { TopBar } from "../topbar";
import { MainView } from "../main";
import { SettingsModal, SudoPasswordModal } from "../settings";
import { AuthModal } from "../auth";
import { CommandPalette } from "../command-palette";
import { GlobalShortcutListener, ShortcutsModal } from "../shortcuts";
import { MobileKeyBar } from "../terminal";
import { ConnectionStatusToast, StatusBar } from "../status";
import { useChromeSurface } from "../../hooks";
import { cn } from "../../lib/cn";

/**
 * Primary layout: full-height sidebar on the left, and a main column whose top
 * bar occupies the titlebar region above the content area.
 */
export const AppShell: React.FC = () => {
  const { chromeBlurred, chromeAlpha } = useChromeSurface();

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar />
      <div
        className={cn("chrome-surface flex min-w-0 flex-1 flex-col", chromeBlurred && "backdrop-blur-2xl")}
        style={{ backgroundColor: `rgb(var(--n-900) / ${chromeAlpha})` }}
      >
        <TopBar />
        <MainView />
        <MobileKeyBar />
        <StatusBar />
      </div>
      <SettingsModal />
      <SudoPasswordModal />
      <AuthModal />
      <ConnectionStatusToast />
      <CommandPalette />
      <ShortcutsModal />
      <GlobalShortcutListener />
    </div>
  );
};
