import React, { useState } from "react";
import { Box, ChevronLeft, FolderPlus, Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Dropdown, DropdownItem, IconButton } from "../ui";
import { NewItemInput } from "./NewItemInput";
import { useAppStore } from "../../store/app";

/** Sidebar view shown after entering a workspace: its projects. */
export const ProjectList: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentProject = useAppStore((s) => s.currentProject);
  const projects = useAppStore((s) => s.projects);
  const loading = useAppStore((s) => s.projectsLoading);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const openProject = useAppStore((s) => s.openProject);
  const createProject = useAppStore((s) => s.createProject);
  const [creating, setCreating] = useState<null | "project" | "folder">(null);

  return (
    <>
      <div className="flex h-9 items-center gap-1 px-2">
        <IconButton label="Back to workspaces" onClick={closeWorkspace}>
          <ChevronLeft size={16} />
        </IconButton>
        <span className="flex-1 truncate text-sm font-medium text-neutral-100">
          {currentWorkspace}
        </span>
        <Dropdown
          trigger={
            <IconButton label="New">
              <Plus size={16} />
            </IconButton>
          }
          align="right"
          width="w-44"
        >
          <DropdownItem icon={<Box size={14} />} onClick={() => setCreating("project")}>
            New Project
          </DropdownItem>
          <DropdownItem icon={<FolderPlus size={14} />} onClick={() => setCreating("folder")}>
            New Folder
          </DropdownItem>
        </Dropdown>
      </div>

      <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
        {creating && (
          <NewItemInput
            placeholder={creating === "folder" ? "folder-name" : "project-name"}
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
        {projects.map((project) => (
          <button
            key={project.path}
            type="button"
            onClick={() => openProject(project)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              project.path === currentProject?.path
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            )}
          >
            <Box size={15} className="text-neutral-500" />
            <span className="flex-1 truncate">{project.name}</span>
          </button>
        ))}
      </nav>
    </>
  );
};
