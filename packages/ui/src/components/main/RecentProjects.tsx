import React from "react";
import { Clock3, Folder } from "lucide-react";
import type { RecentProjectSummary } from "@orquester/api";
import { useAppStore } from "../../store/app";

const relativeTime = (iso: string) => {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export const RecentProjects: React.FC = () => {
  const projects = useAppStore((s) => s.recentProjects);
  const openRecentProject = useAppStore((s) => s.openRecentProject);

  if (projects.length === 0) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-500">Select a project to begin.</div>;
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6 py-8">
      <div className="mb-5">
        <p className="text-sm font-medium text-neutral-200">Recent projects</p>
        <p className="mt-1 text-xs text-neutral-600">Projects you have worked in, shared by this worker.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {projects.map((project: RecentProjectSummary) => (
          <button key={project.path} type="button" onClick={() => void openRecentProject(project)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-neutral-900">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-neutral-500"><Folder size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-200">{project.name}</span>
              <span className="block truncate text-[11px] text-neutral-600">{project.workspace} · {project.interactionCount} interactions</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-600"><Clock3 size={12} />{relativeTime(project.lastInteractedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
