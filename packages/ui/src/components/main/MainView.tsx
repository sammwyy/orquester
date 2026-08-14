import React from "react";
import { cn } from "../../lib/cn";
import { ProjectOverview } from "./ProjectOverview";
import { RecentProjects } from "./RecentProjects";
import { TerminalView } from "../terminal";
import { FileBrowser } from "../files";
import { GitTree } from "../git";
import { RestClient } from "../rest-client";
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
    body = <RecentProjects />;
  } else if (tabs.length === 0) {
    body = <ProjectOverview rootPath={currentProject.path} />;
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
        ) : tab.type === "rest-client" ? (
          <RestClient rootPath={currentProject.path} />
        ) : (
          <FileBrowser rootPath={currentProject.path} />
        )}
      </div>
    ));
  }

  return <main className="my-1 mr-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-neutral-950">{body}</main>;
};
