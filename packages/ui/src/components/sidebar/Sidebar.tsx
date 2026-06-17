import React from "react";
import { cn } from "../../lib/cn";
import { WorkspaceList } from "./WorkspaceList";
import { ProjectList } from "./ProjectList";
import { useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";
import type { ConnectionStatus } from "../../types";

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-neutral-300",
  connecting: "bg-neutral-500 animate-pulse",
  disconnected: "bg-neutral-700",
  error: "bg-red-500"
};

/**
 * Left navigation. Drills from the workspace folder list into a single
 * workspace's projects, mirroring the on-disk `(workspacesDir)/ws/project`
 * layout. Footer shows the active daemon connection.
 */
export const Sidebar: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const { api } = useOrquester();
  const connection = api.connection;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
      {currentWorkspace ? <ProjectList /> : <WorkspaceList />}

      <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
        <span className={cn("h-2 w-2 rounded-full", STATUS_COLOR[connection.status])} />
        <span className="flex-1 truncate text-xs text-neutral-400">{connection.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-neutral-600">
          {api.transportKind}
        </span>
      </div>
    </aside>
  );
};
