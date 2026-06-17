import React from "react";
import { Circle, FolderTree, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { getRegistryIcon } from "../../icons";
import { useActiveTabId, useAppStore, useProjectTabs } from "../../store/app";

/** Tabs for the current project — daemon sessions plus local tool tabs. */
export const TabStrip: React.FC = () => {
  const tabs = useProjectTabs();
  const activeTabId = useActiveTabId();
  const activateTab = useAppStore((s) => s.activateTab);
  const closeTab = useAppStore((s) => s.closeTab);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="app-no-drag flex items-center gap-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const title = tab.type === "session" ? tab.session.title : tab.title;
        const icon =
          tab.type === "session" ? (
            getRegistryIcon(tab.session.kind, tab.session.refId, 13)
          ) : (
            <FolderTree size={13} />
          );
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => activateTab(tab.id)}
            className={cn(
              "group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pl-2 pr-1 text-xs",
              active
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
            )}
          >
            <span className="text-neutral-500">{icon}</span>
            <span className="max-w-[140px] truncate">{title}</span>
            {tab.type === "session" && tab.session.status === "exited" ? (
              <Circle size={7} className="ml-0.5 fill-neutral-600 text-neutral-600" />
            ) : null}
            <button
              type="button"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                void closeTab(tab.id);
              }}
              className="flex h-4 w-4 items-center justify-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
