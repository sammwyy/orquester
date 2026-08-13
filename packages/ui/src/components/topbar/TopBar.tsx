import React from "react";
import { Menu, Settings } from "lucide-react";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TabStrip } from "./TabStrip";
import { TabSwitcher } from "./TabSwitcher";
import { NewTabMenu } from "./NewTabMenu";
import { OpenOnMenu } from "./OpenOnMenu";
import { QuotaMenu } from "./QuotaMenu";
import { WindowControls } from "../layout/WindowControls";
import { ShortcutsButton } from "../shortcuts";
import { IconButton } from "../ui";
import { useIsDesktop } from "../../hooks";
import { useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

const SettingsButton: React.FC = () => {
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  return (
    <div className="app-no-drag">
      <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={15} />
      </IconButton>
    </div>
  );
};

/**
 * Desktop: a single titlebar row (project switcher · tabs · new tab | open-in ·
 * settings · window controls). Mobile: a two-row header (menu · project ·
 * open-in · settings) then a tab row (current tab switcher · new tab).
 */
export const TopBar: React.FC = () => {
  const { useTitlebar } = useOrquester();
  const isDesktop = useIsDesktop();
  const currentProject = useAppStore((s) => s.currentProject);
  const setSidebarDrawer = useAppStore((s) => s.setSidebarDrawer);

  if (!isDesktop) {
    return (
      <header className="flex shrink-0 flex-col">
        <div className="flex h-11 items-center gap-1 px-1">
          <IconButton label="Open menu" onClick={() => setSidebarDrawer(true)}>
            <Menu size={18} />
          </IconButton>
          {currentProject ? (
            <ProjectSwitcher />
          ) : (
            <span className="px-1 text-sm text-neutral-500">Select a project</span>
          )}
          <div className="flex-1" />
          {currentProject && <OpenOnMenu />}
          <QuotaMenu />
          <SettingsButton />
        </div>
        {currentProject && (
          <div className="flex h-11 items-center gap-1 px-2">
            <TabSwitcher />
            <div className="flex-1" />
            <NewTabMenu />
          </div>
        )}
      </header>
    );
  }

  return (
    <header className="app-drag flex h-11 shrink-0 items-stretch">
      <div className="flex flex-1 items-center gap-2 overflow-hidden pl-2">
        {currentProject ? (
          <>
            <ProjectSwitcher />
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
        <QuotaMenu />
        <SettingsButton />
        <ShortcutsButton />
        {useTitlebar && <WindowControls />}
      </div>
    </header>
  );
};
