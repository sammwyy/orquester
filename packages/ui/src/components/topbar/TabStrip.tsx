import React from "react";
import { Bot, FolderTree, TerminalSquare, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../store/app";
import type { TabKind } from "../../types";

const TAB_ICONS: Record<TabKind, React.ReactNode> = {
  terminal: <TerminalSquare size={13} />,
  files: <FolderTree size={13} />,
  agent: <Bot size={13} />
};

/** Horizontal strip of open tabs for the current project. */
export const TabStrip: React.FC = () => {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activateTab = useAppStore((s) => s.activateTab);
  const closeTab = useAppStore((s) => s.closeTab);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="app-no-drag flex items-center gap-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
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
            <span className="text-neutral-500">{TAB_ICONS[tab.kind]}</span>
            <span className="max-w-[140px] truncate">{tab.title}</span>
            <button
              type="button"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
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
