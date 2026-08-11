import React from "react";
import { ChevronDown, Circle, FolderTree } from "lucide-react";
import { AdaptiveMenu, DropdownEmpty, DropdownItem } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useActiveTabId, useAppStore, useProjectTabs } from "../../store/app";
import type { ProjectTab } from "../../store/app";

const tabLabel = (tab: ProjectTab) => (tab.type === "session" ? tab.session.title : tab.title);
const tabIcon = (tab: ProjectTab, size = 14) =>
  tab.type === "session" ? getRegistryIcon(tab.session.kind, tab.session.refId, size) : <FolderTree size={size} />;

/** Mobile: shows the active tab and opens a sheet to switch between tabs. */
export const TabSwitcher: React.FC = () => {
  const tabs = useProjectTabs();
  const activeId = useActiveTabId();
  const activateTab = useAppStore((s) => s.activateTab);
  const active = tabs.find((t) => t.id === activeId);

  const trigger = (
    <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-neutral-800/60 px-2 text-sm text-neutral-200 transition-colors">
      <span className="text-neutral-500">{active ? tabIcon(active, 14) : <FolderTree size={14} />}</span>
      <span className="max-w-[42vw] truncate">{active ? tabLabel(active) : "No tabs"}</span>
      <ChevronDown size={14} className="text-neutral-500" />
    </span>
  );

  return (
    <AdaptiveMenu title="Tabs" trigger={trigger} width="w-64">
      {tabs.length === 0 && <DropdownEmpty>No tabs open</DropdownEmpty>}
      {tabs.map((tab) => (
        <DropdownItem key={tab.id} icon={tabIcon(tab)} onClick={() => activateTab(tab.id)}>
          <span className="flex items-center gap-2">
            {tabLabel(tab)}
            {tab.id === activeId && <Circle size={7} className="fill-neutral-300 text-neutral-300" />}
          </span>
        </DropdownItem>
      ))}
    </AdaptiveMenu>
  );
};
