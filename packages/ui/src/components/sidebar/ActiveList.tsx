import React, { useEffect, useRef } from "react";
import { Folder, FolderTree, Search } from "lucide-react";
import { Input } from "../ui";
import { cn } from "../../lib/cn";
import { getRegistryIcon } from "../../icons";
import { SidebarHeader } from "./SidebarHeader";
import { useActiveWorkspaces, useAppStore, type ActiveProject } from "../../store/app";

const MAX_TAB_ICONS = 3;

/** Small stack of the project's tab icons; exited sessions are dimmed. */
const TabIcons: React.FC<{ tabs: ActiveProject["tabs"] }> = ({ tabs }) => {
  const shown = tabs.slice(0, MAX_TAB_ICONS);
  const rest = tabs.length - shown.length;

  return (
    <span className="flex shrink-0 items-center gap-1 text-neutral-500">
      {shown.map((tab) => (
        <span
          key={tab.id}
          className={cn(
            "flex h-3.5 w-3.5 items-center justify-center",
            tab.type === "session" && tab.session.status === "exited" && "opacity-40"
          )}
        >
          {tab.type === "session" ? (
            getRegistryIcon(tab.session.kind, tab.session.refId, 13)
          ) : (
            <FolderTree size={13} />
          )}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] tabular-nums text-neutral-600">+{rest}</span>}
    </span>
  );
};

/**
 * Sidebar view listing only what is running: every project holding tabs, grouped
 * under its workspace. Selecting a project opens it directly — there is no
 * per-workspace drill-down here.
 */
export const ActiveList: React.FC = () => {
  const groups = useActiveWorkspaces();
  const currentProject = useAppStore((s) => s.currentProject);
  const openProject = useAppStore((s) => s.openProject);
  const scrollTop = useAppStore((s) => s.clientUiState.sidebarScrollByKey.active ?? 0);
  const setSidebarScroll = useAppStore((s) => s.setSidebarScroll);
  const navRef = useRef<HTMLElement>(null);
  const filter = useAppStore((s) => s.clientUiState.sidebarFilterByKey.active ?? "");
  const setSidebarFilter = useAppStore((s) => s.setSidebarFilter);

  useEffect(() => {
    if (navRef.current) navRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  return (
    <>
      <SidebarHeader />

      <nav ref={navRef} onScroll={(event) => setSidebarScroll("active", event.currentTarget.scrollTop)} className="flex-1 overflow-y-auto p-2">
        <div className="relative mb-2"><Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-600" /><Input value={filter} onChange={(event) => setSidebarFilter("active", event.target.value)} placeholder="Filter projects" className="h-7 pl-7 text-xs" /></div>
        {groups.length === 0 && (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-neutral-500">Nothing running</p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
              Projects with open terminals, agents or files show up here.
            </p>
          </div>
        )}

        {groups.map((group) => ({ ...group, projects: group.projects.filter(({ project }) => project.name.toLowerCase().includes(filter.trim().toLowerCase())) })).filter((group) => group.projects.length > 0).map((group) => (
          <div key={group.name} className="mb-2 last:mb-0">
            <div className="flex h-6 items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              <Folder size={11} className="shrink-0 text-neutral-600" />
              <span className="truncate">{group.name || "Other"}</span>
            </div>

            <div className="ml-[10px] space-y-px border-l border-neutral-800 pl-2">
              {group.projects.map(({ project, tabs }) => (
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
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <TabIcons tabs={tabs} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
};
