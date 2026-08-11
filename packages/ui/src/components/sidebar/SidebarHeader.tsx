import React from "react";
import { PanelLeftClose } from "lucide-react";
import { cn } from "../../lib/cn";
import { IconButton } from "../ui";
import { useActiveWorkspaces, useAppStore, type SidebarView } from "../../store/app";

const TABS: { view: SidebarView; label: string }[] = [
  { view: "workspaces", label: "Workspaces" },
  { view: "active", label: "Active" }
];

export interface SidebarHeaderProps {
  /** View-specific trailing action (e.g. "new workspace"); the slot is always reserved. */
  action?: React.ReactNode;
}

/** Sidebar top row: collapse toggle, the view switcher and one contextual action. */
export const SidebarHeader: React.FC<SidebarHeaderProps> = ({ action }) => {
  const view = useAppStore((s) => s.sidebarView);
  const setView = useAppStore((s) => s.setSidebarView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeCount = useActiveWorkspaces().reduce((total, w) => total + w.projects.length, 0);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-2">
      <IconButton label="Collapse sidebar" className="hidden shrink-0 md:inline-flex" onClick={toggleSidebar}>
        <PanelLeftClose size={15} />
      </IconButton>

      <div
        role="tablist"
        className="flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-md bg-neutral-950/60 p-0.5 ring-1 ring-inset ring-neutral-800"
      >
        {TABS.map((tab) => {
          const selected = tab.view === view;
          return (
            <button
              key={tab.view}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setView(tab.view)}
              className={cn(
                "flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 text-[11px] font-medium transition-colors",
                selected
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <span className="truncate">{tab.label}</span>
              {tab.view === "active" && activeCount > 0 && (
                <span
                  className={cn(
                    "shrink-0 rounded px-1 text-[10px] leading-4",
                    selected ? "bg-neutral-700 text-neutral-200" : "bg-neutral-800/80 text-neutral-500"
                  )}
                >
                  {activeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <span className="flex h-7 w-7 shrink-0 items-center justify-center">{action}</span>
    </div>
  );
};
