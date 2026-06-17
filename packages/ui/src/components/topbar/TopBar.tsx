import React from "react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TabStrip } from "./TabStrip";
import { NewTabMenu } from "./NewTabMenu";
import { OpenOnMenu } from "./OpenOnMenu";
import { WindowControls } from "../layout/WindowControls";
import { useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

/**
 * Sits in the native titlebar region (the whole bar is a drag handle, with
 * interactive controls opted out via `app-no-drag`). Hosts the project
 * switcher, tab strip and new-tab menu on the left; "Open on" and the window
 * caption buttons on the right.
 */
export const TopBar: React.FC = () => {
  const { useTitlebar } = useOrquester();
  const currentProject = useAppStore((s) => s.currentProject);

  return (
    <header className="app-drag flex h-11 shrink-0 items-stretch border-b border-neutral-800 bg-neutral-900/60">
      <div className="flex flex-1 items-center gap-2 overflow-hidden pl-2">
        {currentProject ? (
          <>
            <ProjectSwitcher />
            <div className="h-4 w-px bg-neutral-800" />
            <div className="flex items-center gap-1 overflow-x-auto">
              <TabStrip />
              <NewTabMenu />
            </div>
          </>
        ) : (
          <span className="px-2 text-sm text-neutral-500">Select a project to begin</span>
        )}
      </div>

      <div className="flex items-center gap-1 pr-1">
        {currentProject && (
          <div className="app-no-drag pr-1">
            <OpenOnMenu />
          </div>
        )}
        {useTitlebar && <WindowControls />}
      </div>
    </header>
  );
};
