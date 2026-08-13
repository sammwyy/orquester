import React, { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Search } from "lucide-react";
import type { ProjectSummary } from "@orquester/api";
import { cn } from "../../lib/cn";
import { Modal } from "../ui";
import { useApi } from "../../context/orquester-context";
import { workspaceService } from "../../services";
import { useActiveWorkspaces, useAppStore } from "../../store/app";

/**
 * Global "go to project" palette (Ctrl/Cmd+K). Empty query shows whatever the
 * "Active" sidebar shows (projects with an open tab); typing searches every
 * project in every workspace by project name or workspace name.
 */
export const CommandPalette: React.FC = () => {
  const api = useApi();
  const openProject = useAppStore((state) => state.openProject);
  const workspaces = useAppStore((state) => state.workspaces);
  const activeGroups = useActiveWorkspaces();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allProjects, setAllProjects] = useState<ProjectSummary[] | null>(null);
  const [highlight, setHighlight] = useState(0);
  const highlightedRef = useRef<HTMLButtonElement>(null);

  // Global open shortcut. Skipped inside the terminal, where Ctrl+K is the
  // readline kill-line binding — stealing it there would break every shell.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if ((event.target as HTMLElement | null)?.closest(".xterm")) return;
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Fresh index every time it opens: cheap for the size of a project tree,
  // and avoids showing a stale list after projects are added elsewhere.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    setAllProjects(null);
    Promise.all(workspaces.map((workspace) => workspaceService.listProjects(api, workspace.name).catch(() => [] as ProjectSummary[])))
      .then((lists) => setAllProjects(lists.flat()));
  }, [open, api, workspaces]);

  const activeProjects = useMemo(
    () => activeGroups.flatMap((group) => group.projects.map(({ project }) => project)),
    [activeGroups]
  );

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return activeProjects;
    const source = allProjects ?? activeProjects;
    return source.filter(
      (project) => project.name.toLowerCase().includes(trimmed) || project.workspace.toLowerCase().includes(trimmed)
    );
  }, [query, allProjects, activeProjects]);

  useEffect(() => setHighlight(0), [results.length, query]);

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const select = (project: ProjectSummary) => {
    openProject(project);
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      backdropClassName="items-start pt-[14vh]"
      className="h-fit max-h-[60vh] w-full max-w-xl flex-col"
    >
      <div className="flex items-center gap-2 border-b border-neutral-800/70 px-3.5 py-3">
        <Search size={15} className="shrink-0 text-neutral-500" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const picked = results[highlight];
              if (picked) select(picked);
            }
          }}
          placeholder="Go to project…"
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!query.trim() && results.length > 0 && (
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-600">Active</p>
        )}
        {results.length === 0 && <p className="px-3 py-6 text-center text-xs text-neutral-500">No projects found.</p>}
        {results.map((project, index) => (
          <button
            key={project.path}
            ref={index === highlight ? highlightedRef : null}
            type="button"
            onMouseEnter={() => setHighlight(index)}
            onClick={() => select(project)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
              index === highlight ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
            )}
          >
            <Folder size={14} className="shrink-0 text-neutral-600" />
            <span className="min-w-0 flex-1 truncate">
              {project.workspace && <span className="text-neutral-500">{project.workspace}/</span>}
              <span className="text-neutral-100">{project.name}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
};
