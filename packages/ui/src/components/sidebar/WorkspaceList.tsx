import React from "react";
import { Folder, FolderPlus } from "lucide-react";
import { IconButton } from "../ui";
import { useWorkspaces } from "../../hooks";
import { useAppStore } from "../../store/app";

/** Root sidebar view: the list of workspace folders. */
export const WorkspaceList: React.FC = () => {
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const { data: workspaces, loading } = useWorkspaces();

  // TODO: wire create-workspace (mkdir under workspacesDir) once name input exists.
  const newWorkspace = () => console.info("[orquester] new workspace (not yet implemented)");

  return (
    <>
      <div className="flex h-9 items-center justify-between px-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          Workspaces
        </span>
        <IconButton label="New workspace" onClick={newWorkspace}>
          <FolderPlus size={15} />
        </IconButton>
      </div>

      <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {loading && <p className="px-2 py-2 text-xs text-neutral-600">Loading…</p>}
        {!loading && workspaces.length === 0 && (
          <p className="px-2 py-2 text-xs text-neutral-600">No workspaces yet</p>
        )}
        {workspaces.map((workspace) => (
          <button
            key={workspace.path}
            type="button"
            onClick={() => openWorkspace(workspace.name)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            <Folder size={15} className="text-neutral-500" />
            <span className="flex-1 truncate">{workspace.name}</span>
            <span className="text-xs text-neutral-600">{workspace.projectCount}</span>
          </button>
        ))}
      </nav>
    </>
  );
};
