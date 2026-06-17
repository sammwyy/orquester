import React from "react";
import { WorkspaceList } from "./WorkspaceList";
import { ProjectList } from "./ProjectList";
import { ServerSwitcher } from "../servers";
import { useAppStore } from "../../store/app";

/**
 * Left navigation. Drills from the workspace folder list into a single
 * workspace's projects, mirroring the on-disk `(workspacesDir)/ws/project`
 * layout. Footer hosts the daemon server switcher.
 */
export const Sidebar: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900/40">
      {currentWorkspace ? <ProjectList /> : <WorkspaceList />}
      <ServerSwitcher />
    </aside>
  );
};
