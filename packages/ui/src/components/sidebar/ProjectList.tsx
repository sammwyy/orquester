import React, { useEffect, useRef, useState } from "react";
import { Box, ChevronLeft, FolderPlus, Plus, Search } from "lucide-react";
import { cn } from "../../lib/cn";
import { Dropdown, DropdownItem, IconButton, Input } from "../ui";
import { NewItemInput } from "./NewItemInput";
import { NewProjectModal } from "./NewProjectModal";
import { SidebarHeader } from "./SidebarHeader";
import { useAppStore } from "../../store/app";

/** Workspaces view after entering a workspace: its projects. */
export const ProjectList: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentProject = useAppStore((s) => s.currentProject);
  const projects = useAppStore((s) => s.projects);
  const loading = useAppStore((s) => s.projectsLoading);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const openProject = useAppStore((s) => s.openProject);
  const createProject = useAppStore((s) => s.createProject);
  const scrollKey = `workspace:${currentWorkspace ?? ""}`;
  const scrollTop = useAppStore((s) => s.clientUiState.sidebarScrollByKey[scrollKey] ?? 0);
  const filter = useAppStore((s) => s.clientUiState.sidebarFilterByKey[scrollKey] ?? "");
  const setSidebarScroll = useAppStore((s) => s.setSidebarScroll);
  const setSidebarFilter = useAppStore((s) => s.setSidebarFilter);
  const navRef = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState<null | "folder">(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    if (navRef.current) navRef.current.scrollTop = scrollTop;
  }, [scrollTop, scrollKey]);

  return (
    <>
      <SidebarHeader
        action={
          <Dropdown
            trigger={
              <IconButton label="New">
                <Plus size={16} />
              </IconButton>
            }
            align="right"
            width="w-44"
          >
            <DropdownItem icon={<Box size={14} />} onClick={() => setNewProjectOpen(true)}>
              New Project
            </DropdownItem>
            <DropdownItem icon={<FolderPlus size={14} />} onClick={() => setCreating("folder")}>
              New Folder
            </DropdownItem>
          </Dropdown>
        }
      />

      <div className="mx-2 h-px shrink-0 bg-neutral-800/60" />

      <div className="flex h-8 shrink-0 items-center px-2 pt-1">
        <button
          type="button"
          onClick={closeWorkspace}
          title="Back to workspaces"
          className="flex min-w-0 items-center gap-1 rounded-md py-0.5 pl-0.5 pr-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
        >
          <ChevronLeft size={14} className="shrink-0" />
          <span className="truncate text-xs font-medium">{currentWorkspace}</span>
        </button>
      </div>

      <nav ref={navRef} onScroll={(event) => setSidebarScroll(scrollKey, event.currentTarget.scrollTop)} className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
        <div className="relative mb-2"><Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-600" /><Input value={filter} onChange={(event) => setSidebarFilter(scrollKey, event.target.value)} placeholder="Filter projects" className="h-7 pl-7 text-xs" /></div>
        {creating === "folder" && (
          <NewItemInput
            placeholder="folder-name"
            onCancel={() => setCreating(null)}
            onSubmit={(name) => {
              setCreating(null);
              void createProject(name);
            }}
          />
        )}

        {loading && projects.length === 0 && (
          <p className="px-2 py-2 text-xs text-neutral-600">Loading…</p>
        )}
        {!loading && projects.length === 0 && !creating && (
          <p className="px-2 py-2 text-xs text-neutral-600">No projects yet</p>
        )}
        {projects.filter((project) => project.name.toLowerCase().includes(filter.trim().toLowerCase())).map((project) => (
          <button
            key={project.path}
            type="button"
            onClick={() => openProject(project)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              project.path === currentProject?.path
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100"
            )}
          >
            <Box size={15} className="shrink-0 text-neutral-500" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
          </button>
        ))}
      </nav>

      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  );
};
