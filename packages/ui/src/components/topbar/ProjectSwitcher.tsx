import React from "react";
import { Box, Check, ChevronDown } from "lucide-react";
import { Dropdown, DropdownEmpty, DropdownItem, DropdownLabel } from "../ui";
import { useProjects } from "../../hooks";
import { useAppStore } from "../../store/app";

/** Titlebar dropdown showing the active project and switching between siblings. */
export const ProjectSwitcher: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentProject = useAppStore((s) => s.currentProject);
  const openProject = useAppStore((s) => s.openProject);
  const { data: projects, loading } = useProjects(currentWorkspace);

  const trigger = (
    <span className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-neutral-100 hover:bg-neutral-800">
      <Box size={14} className="text-neutral-500" />
      <span className="max-w-[200px] truncate">{currentProject ?? "No project"}</span>
      <ChevronDown size={13} className="text-neutral-500" />
    </span>
  );

  return (
    <Dropdown trigger={trigger} width="w-64">
      <DropdownLabel>{currentWorkspace ?? "Workspace"}</DropdownLabel>
      {loading && <DropdownEmpty>Loading…</DropdownEmpty>}
      {!loading && projects.length === 0 && <DropdownEmpty>No projects</DropdownEmpty>}
      {projects.map((project) => (
        <DropdownItem
          key={project.path}
          icon={project.name === currentProject ? <Check size={14} /> : <Box size={14} />}
          onClick={() => openProject(project.name)}
        >
          {project.name}
        </DropdownItem>
      ))}
    </Dropdown>
  );
};
