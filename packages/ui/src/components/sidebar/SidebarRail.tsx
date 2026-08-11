import React from "react";
import { Activity, Box, ChevronLeft, Folder, Folders, PanelLeftOpen, Server } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../ui";
import { useActiveWorkspaces, useAppStore } from "../../store/app";
import type { ConnectionStatus } from "../../types";

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-neutral-500 animate-pulse",
  disconnected: "bg-neutral-700",
  error: "bg-red-500"
};

const RailButton: React.FC<{
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, active, onClick, children }) => (
  <Tooltip label={label}>
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      )}
    >
      {children}
    </button>
  </Tooltip>
);

/** Icon-only sidebar shown when collapsed; hover reveals labels via portal. */
export const SidebarRail: React.FC = () => {
  const view = useAppStore((s) => s.sidebarView);
  const setView = useAppStore((s) => s.setSidebarView);
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentProject = useAppStore((s) => s.currentProject);
  const workspaces = useAppStore((s) => s.workspaces);
  const projects = useAppStore((s) => s.projects);
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const openProject = useAppStore((s) => s.openProject);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const activeServer = connections.find((c) => c.id === activeId);
  const activeGroups = useActiveWorkspaces();

  return (
    <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-neutral-800 bg-neutral-900/40 py-2">
      <RailButton label="Expand sidebar" onClick={toggleSidebar}>
        <PanelLeftOpen size={16} />
      </RailButton>

      <div className="my-1 h-px w-6 bg-neutral-800" />

      <RailButton
        label="Workspaces"
        active={view === "workspaces"}
        onClick={() => setView("workspaces")}
      >
        <Folders size={16} />
      </RailButton>
      <RailButton label="Active" active={view === "active"} onClick={() => setView("active")}>
        <Activity size={16} />
      </RailButton>

      <div className="my-1 h-px w-6 bg-neutral-800" />

      {view === "workspaces" && currentWorkspace && (
        <RailButton label="Back to workspaces" onClick={closeWorkspace}>
          <ChevronLeft size={16} />
        </RailButton>
      )}

      <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {view === "active"
          ? activeGroups.flatMap((group) =>
              group.projects.map(({ project }) => (
                <RailButton
                  key={project.path}
                  label={`${group.name} / ${project.name}`}
                  active={project.path === currentProject?.path}
                  onClick={() => openProject(project)}
                >
                  <Box size={16} />
                </RailButton>
              ))
            )
          : currentWorkspace
            ? projects.map((project) => (
                <RailButton
                  key={project.path}
                  label={project.name}
                  active={project.path === currentProject?.path}
                  onClick={() => openProject(project)}
                >
                  <Box size={16} />
                </RailButton>
              ))
            : workspaces.map((workspace) => (
                <RailButton
                  key={workspace.path}
                  label={workspace.name}
                  onClick={() => void openWorkspace(workspace.name)}
                >
                  <Folder size={16} />
                </RailButton>
              ))}
      </nav>

      <Tooltip label={activeServer?.name ?? "Server"}>
        <button
          type="button"
          aria-label="Server"
          onClick={toggleSidebar}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <Server size={16} />
          <span
            className={cn(
              "absolute bottom-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-neutral-900",
              STATUS_COLOR[connectionStatus]
            )}
          />
        </button>
      </Tooltip>
    </aside>
  );
};
