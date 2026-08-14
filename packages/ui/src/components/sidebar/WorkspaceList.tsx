import React, { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, Search } from "lucide-react";
import { IconButton, Input } from "../ui";
import { NewItemInput } from "./NewItemInput";
import { SidebarHeader } from "./SidebarHeader";
import { useAppStore } from "../../store/app";

/** Root of the workspaces view: the list of workspace folders. */
export const WorkspaceList: React.FC = () => {
  const workspaces = useAppStore((s) => s.workspaces);
  const loading = useAppStore((s) => s.workspacesLoading);
  const openWorkspace = useAppStore((s) => s.openWorkspace);
  const createWorkspace = useAppStore((s) => s.createWorkspace);
  const scrollTop = useAppStore((s) => s.clientUiState.sidebarScrollByKey.workspaces ?? 0);
  const setSidebarScroll = useAppStore((s) => s.setSidebarScroll);
  const navRef = useRef<HTMLElement>(null);
  const filter = useAppStore((s) => s.clientUiState.sidebarFilterByKey.workspaces ?? "");
  const setSidebarFilter = useAppStore((s) => s.setSidebarFilter);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (navRef.current) navRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  return (
    <>
      <SidebarHeader
        action={
          <IconButton label="New workspace" onClick={() => setCreating(true)}>
            <FolderPlus size={15} />
          </IconButton>
        }
      />

      <nav ref={navRef} onScroll={(event) => setSidebarScroll("workspaces", event.currentTarget.scrollTop)} className="flex-1 space-y-px overflow-y-auto p-2">
        <div className="relative mb-2"><Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-600" /><Input value={filter} onChange={(event) => setSidebarFilter("workspaces", event.target.value)} placeholder="Filter workspaces" className="h-7 pl-7 text-xs" /></div>
        {creating && (
          <NewItemInput
            placeholder="workspace-name"
            onCancel={() => setCreating(false)}
            onSubmit={(name) => {
              setCreating(false);
              void createWorkspace(name);
            }}
          />
        )}

        {loading && workspaces.length === 0 && (
          <p className="px-2 py-2 text-xs text-neutral-600">Loading…</p>
        )}
        {!loading && workspaces.length === 0 && !creating && (
          <p className="px-2 py-2 text-xs text-neutral-600">No workspaces yet</p>
        )}
        {workspaces.filter((workspace) => workspace.name.toLowerCase().includes(filter.trim().toLowerCase())).map((workspace) => (
          <button
            key={workspace.path}
            type="button"
            onClick={() => void openWorkspace(workspace.name)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            <Folder size={15} className="shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-600">
              {workspace.projectCount}
            </span>
          </button>
        ))}
      </nav>
    </>
  );
};
