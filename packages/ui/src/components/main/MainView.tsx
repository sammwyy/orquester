import React from "react";
import { LayoutGrid, MousePointerClick } from "lucide-react";
import { cn } from "../../lib/cn";
import { EmptyState } from "./EmptyState";
import { TerminalView } from "../terminal";
import { FileBrowser } from "../files";
import { GitTree } from "../git";
import { useActiveTabId, useAppStore, useProjectTabs } from "../../store/app";

/**
 * Main panel. Every tab of the current project is kept mounted (terminal output
 * streams stay open) and only the active one is shown, so switching tabs never
 * tears anything down.
 */
export const MainView: React.FC = () => {
  const currentProject = useAppStore((s) => s.currentProject);
  const tabs = useProjectTabs();
  const activeId = useActiveTabId();

  let body: React.ReactNode;

  if (!currentProject) {
    body = (
      <EmptyState
        icon={<LayoutGrid size={40} strokeWidth={1.25} />}
        title="No project selected"
        description="Pick a workspace and open a project from the sidebar to get started."
      />
    );
  } else if (tabs.length === 0) {
    body = (
      <EmptyState
        icon={<MousePointerClick size={40} strokeWidth={1.25} />}
        title="No tabs open"
        description='Use the "+" button in the top bar to open a terminal, agent or file browser.'
      />
    );
  } else {
    body = tabs.map((tab) => (
      <div
        key={tab.id}
        className={cn("h-full w-full", tab.id === activeId ? "block" : "hidden")}
      >
        {tab.type === "session" ? (
          <TerminalView session={tab.session} />
        ) : tab.type === "git" ? (
          <GitTree rootPath={currentProject.path} />
        ) : (
          <FileBrowser rootPath={currentProject.path} />
        )}
      </div>
    ));
  }

  return <main className="my-1 mr-1 min-h-0 flex-1 overflow-hidden rounded-xl bg-neutral-950">{body}</main>;
};
