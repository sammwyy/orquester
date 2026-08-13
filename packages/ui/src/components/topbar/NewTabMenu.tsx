import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FolderTree, GitGraph, Globe, LoaderCircle, Plus } from "lucide-react";
import type { AgentConversationSummary } from "@orquester/api";
import {
  AdaptiveMenu,
  DropdownContext,
  DropdownEmpty,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  IconButton
} from "../ui";
import { getRegistryIcon } from "../../icons";
import { useIsDesktop, useRegistry } from "../../hooks";
import { useAppStore } from "../../store/app";

const HOVER_OPEN_DELAY = 120;
const HOVER_CLOSE_DELAY = 250;
const SUBMENU_WIDTH = 280;

/**
 * One agent row in the "+" menu. Clicking it opens a new chat directly, same
 * as before; hovering (desktop only) opens a flyout with that agent's past
 * conversations to resume, flipping to whichever side of the row has room.
 */
const AgentMenuItem: React.FC<{
  agentId: string;
  agentName: string;
  rootPath: string | null;
  onNewChat: () => void;
  onResume: (conversationId: string) => void;
}> = ({ agentId, agentName, rootPath, onNewChat, onResume }) => {
  const isDesktop = useIsDesktop();
  const { close } = useContext(DropdownContext);
  const loadAgentConversations = useAppStore((s) => s.loadAgentConversations);
  const allConversations = useAppStore((s) => (rootPath ? s.agentConversationsByProject[rootPath] : undefined));
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const conversations = allConversations?.filter((c) => c.agentRefId === agentId) ?? null;
  const loaded = allConversations !== undefined;

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  useEffect(() => clearTimers, []);

  const scheduleOpen = () => {
    if (!isDesktop || !rootPath) return;
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) {
        const openRight = window.innerWidth - rect.right >= SUBMENU_WIDTH + 16;
        setPosition({
          top: Math.min(rect.top, window.innerHeight - 220),
          ...(openRight ? { left: rect.right + 4 } : { right: window.innerWidth - rect.left + 4 })
        });
      }
      setOpen(true);
      void loadAgentConversations(rootPath);
    }, HOVER_OPEN_DELAY);
  };

  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  };

  const resume = (conversation: AgentConversationSummary) => {
    onResume(conversation.id);
    close();
  };

  return (
    <div ref={rowRef} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onNewChat();
          close();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 active:bg-neutral-700/80"
      >
        <span className="flex h-4 w-4 items-center justify-center text-neutral-500">{getRegistryIcon("agent", agentId, 14)}</span>
        <span className="flex-1 truncate">{agentName}</span>
        {isDesktop && rootPath && <ChevronRight size={12} className="shrink-0 text-neutral-600" />}
      </button>

      {open &&
        position &&
        createPortal(
          <div
            role="menu"
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            style={{ position: "fixed", top: position.top, left: position.left, right: position.right, width: SUBMENU_WIDTH }}
            className="animate-menu-in z-[210] max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-800/80 bg-neutral-900/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl"
          >
            <DropdownItem icon={<Plus size={14} />} onClick={onNewChat}>
              New Chat
            </DropdownItem>
            {(!loaded || (conversations?.length ?? 0) > 0) && <DropdownSeparator />}
            {!loaded && (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-neutral-600">
                <LoaderCircle size={13} className="animate-spin" /> Loading conversations…
              </div>
            )}
            {loaded && conversations?.length === 0 && <DropdownEmpty>No past conversations</DropdownEmpty>}
            {conversations?.map((conversation) => (
              <DropdownItem key={conversation.id} onClick={() => resume(conversation)}>
                {conversation.title}
              </DropdownItem>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * The "+" new-tab button. Lists detected shells and INSTALLED agents (manage
 * installs in Settings → Agents / Harnesses) plus built-in tools; choosing one
 * opens a tab in the current project. Hovering an agent (desktop) opens its
 * conversation history to resume instead of always starting fresh.
 */
export const NewTabMenu: React.FC = () => {
  const openTab = useAppStore((s) => s.openTab);
  const openTool = useAppStore((s) => s.openTool);
  const currentProject = useAppStore((s) => s.currentProject);
  const registry = useRegistry();

  const shells = registry.shells.filter((s) => s.enabled);
  const agents = registry.agents.filter((a) => a.enabled);

  return (
    <AdaptiveMenu
      title="New tab"
      trigger={
        <IconButton label="New tab" className="app-no-drag">
          <Plus size={16} />
        </IconButton>
      }
      width="w-60"
    >
      <DropdownLabel>Shells</DropdownLabel>
      {shells.length === 0 && <DropdownEmpty>No shells detected</DropdownEmpty>}
      {shells.map((shell) => (
        <DropdownItem
          key={shell.id}
          icon={getRegistryIcon("shell", shell.id, 14)}
          onClick={() => void openTab("shell", shell.id, shell.name)}
        >
          {shell.name}
        </DropdownItem>
      ))}

      <DropdownSeparator />

      <DropdownLabel>Tools</DropdownLabel>
      <DropdownItem icon={<FolderTree size={14} />} onClick={() => openTool("files")}>
        File Browser
      </DropdownItem>
      <DropdownItem icon={<GitGraph size={14} />} onClick={() => openTool("git")}>
        Git Tree
      </DropdownItem>
      <DropdownItem icon={<Globe size={14} />} onClick={() => openTool("rest-client")}>
        Rest Client
      </DropdownItem>

      <DropdownSeparator />

      <DropdownLabel>Agents</DropdownLabel>
      {agents.length === 0 && <DropdownEmpty>No agents installed</DropdownEmpty>}
      {agents.map((agent) => (
        <AgentMenuItem
          key={agent.id}
          agentId={agent.id}
          agentName={agent.name}
          rootPath={currentProject?.path ?? null}
          onNewChat={() => void openTab("agent", agent.id, agent.name)}
          onResume={(conversationId) => void openTab("agent", agent.id, agent.name, conversationId)}
        />
      ))}
    </AdaptiveMenu>
  );
};
