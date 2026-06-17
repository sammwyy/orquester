import React from "react";
import { Bot, FolderTree, LayoutGrid, MousePointerClick, TerminalSquare } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { useActiveTabId, useAppStore, useCurrentTabs } from "../../store/app";
import type { Tab, TabKind } from "../../types";

const TAB_ICONS: Record<TabKind, React.ReactNode> = {
  terminal: <TerminalSquare size={40} strokeWidth={1.25} />,
  files: <FolderTree size={40} strokeWidth={1.25} />,
  agent: <Bot size={40} strokeWidth={1.25} />
};

/** Skeleton content for the active tab — real renderers land later. */
const TabContent: React.FC<{ tab: Tab }> = ({ tab }) => (
  <EmptyState
    icon={TAB_ICONS[tab.kind]}
    title={tab.title}
    description={`${tab.kind} surface — skeleton placeholder, no functionality yet.`}
  />
);

/** Main panel: renders the active tab, or guidance when nothing is open. */
export const MainView: React.FC = () => {
  const currentProject = useAppStore((s) => s.currentProject);
  const tabs = useCurrentTabs();
  const activeTabId = useActiveTabId();

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
        description='Use the "+" button in the top bar to open a terminal, file explorer or agent.'
      />
    );
  } else {
    const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
    body = <TabContent tab={active} />;
  }

  return <main className="min-h-0 flex-1 overflow-hidden bg-neutral-950">{body}</main>;
};
