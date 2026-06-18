import React from "react";
import { Sidebar } from "../sidebar";
import { TopBar } from "../topbar";
import { MainView } from "../main";
import { SettingsModal } from "../settings";
import { AuthModal } from "../auth";
import { MobileKeyBar } from "../terminal";
import { ConnectionStatusToast } from "../status";

/**
 * Primary layout: full-height sidebar on the left, and a main column whose top
 * bar occupies the titlebar region above the content area.
 */
export const AppShell: React.FC = () => (
  <div className="flex min-h-0 flex-1">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <MainView />
      <MobileKeyBar />
    </div>
    <SettingsModal />
    <AuthModal />
    <ConnectionStatusToast />
  </div>
);
