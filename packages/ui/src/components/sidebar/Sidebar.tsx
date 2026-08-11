import React from "react";
import { cn } from "../../lib/cn";
import { ActiveList } from "./ActiveList";
import { WorkspaceList } from "./WorkspaceList";
import { ProjectList } from "./ProjectList";
import { SidebarRail } from "./SidebarRail";
import { ServerSwitcher } from "../servers";
import { useIsDesktop } from "../../hooks";
import { useAppStore } from "../../store/app";

/**
 * Left navigation. Desktop: inline, collapsible to an icon rail. Mobile: an
 * off-canvas drawer (with backdrop) toggled from the top bar.
 */
export const Sidebar: React.FC = () => {
  const isDesktop = useIsDesktop();
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
      <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
        {body}
        <ServerSwitcher />
      </aside>
    );
  }

  // --- Mobile drawer ---
  return (
    <>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawer(false)} />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-900 shadow-xl transition-transform duration-200",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {body}
        <ServerSwitcher />
      </aside>
    </>
  );
};
