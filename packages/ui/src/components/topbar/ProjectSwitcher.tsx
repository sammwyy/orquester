import React from "react";
import { Box, Check, ChevronDown } from "lucide-react";
import { Dropdown, DropdownEmpty, DropdownItem, DropdownLabel } from "../ui";
import { useAppStore } from "../../store/app";

/** Titlebar dropdown showing the active project and switching between siblings. */
export const ProjectSwitcher: React.FC = () => {
  const currentWorkspace = useAppStore((s) => s.currentWorkspace);
  const currentProject = useAppStore((s) => s.currentProject);
  const projects = useAppStore((s) => s.projects);
  const projectsLoading = useAppStore((s) => s.projectsLoading);
  const openProject = useAppStore((s) => s.openProject);

  const trigger = (
    <span className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-neutral-100 hover:bg-neutral-800">
      <Box size={14} className="text-neutral-500" />
      <span className="max-w-[200px] truncate">{currentProject?.name ?? "No project"}</span>
      <ChevronDown size={13} className="text-neutral-500" />
    </span>
  );

  return (
    <Dropdown trigger={trigger} width="w-64">
      <DropdownLabel>{currentProject?.workspace ?? currentWorkspace ?? "Workspace"}</DropdownLabel>
      {projectsLoading && <DropdownEmpty>Loading…</DropdownEmpty>}
      {!projectsLoading && projects.length === 0 && <DropdownEmpty>No projects</DropdownEmpty>}
      {projects.map((project) => (
        <DropdownItem
          key={project.path}
          icon={project.path === currentProject?.path ? <Check size={14} /> : <Box size={14} />}
          onClick={() => openProject(project)}
        >
          {project.name}
        </DropdownItem>
      ))}
    </Dropdown>
  );
};
