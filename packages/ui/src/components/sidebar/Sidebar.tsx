import React from "react";
import { cn } from "../../lib/cn";
import { ActiveList } from "./ActiveList";
import { WorkspaceList } from "./WorkspaceList";
import { ProjectList } from "./ProjectList";
import { SidebarRail } from "./SidebarRail";
import { ServerSwitcher } from "../servers";
import { useChromeSurface, useIsDesktop } from "../../hooks";
import { useAppStore } from "../../store/app";

/**
 * Left navigation. Desktop: inline, collapsible to an icon rail. Mobile: an
 * off-canvas drawer (with backdrop) toggled from the top bar.
 */
export const Sidebar: React.FC = () => {
  const isDesktop = useIsDesktop();
  const { blurred, alpha } = useChromeSurface();
  const view = useAppStore((s) => s.sidebarView);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const drawerOpen = useAppStore((s) => s.sidebarDrawerOpen);
  const setDrawer = useAppStore((s) => s.setSidebarDrawer);

  const body =
    view === "active" ? <ActiveList /> : currentWorkspace ? <ProjectList /> : <WorkspaceList />;

  // --- Desktop ---
  if (isDesktop) {
    if (collapsed) {
      return <SidebarRail />;
    }
    return (
      <aside
        className={cn(
          "sidebar-surface flex w-64 shrink-0 flex-col",
          blurred && "backdrop-blur-2xl"
        )}
        style={{ backgroundColor: `rgb(var(--n-900) / ${alpha})` }}
      >
        {body}
        <ServerSwitcher />
      </aside>
    );
  }

  // --- Mobile drawer ---
  return (
    <>
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 rounded-[var(--window-radius)] bg-black/50"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className={cn(
          "sidebar-surface fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col shadow-xl transition-transform duration-200",
          "rounded-l-[var(--window-radius)]",
          blurred && "backdrop-blur-2xl",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ backgroundColor: `rgb(var(--n-900) / ${alpha})` }}
      >
        {body}
        <ServerSwitcher />
      </aside>
    </>
  );
};
