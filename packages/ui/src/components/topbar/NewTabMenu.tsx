import React from "react";
import { FolderTree, GitGraph, Globe, Plus } from "lucide-react";
import {
  AdaptiveMenu,
  DropdownEmpty,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  IconButton
} from "../ui";
import { getRegistryIcon } from "../../icons";
import { useRegistry } from "../../hooks";
import { useAppStore } from "../../store/app";

/**
 * The "+" new-tab button. Lists detected shells and INSTALLED agents (manage
 * installs in Settings → Agents / Harnesses) plus built-in tools; choosing one
 * opens a tab in the current project.
 */
export const NewTabMenu: React.FC = () => {
  const openTab = useAppStore((s) => s.openTab);
  const openTool = useAppStore((s) => s.openTool);
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
        <DropdownItem
          key={agent.id}
          icon={getRegistryIcon("agent", agent.id, 14)}
          onClick={() => void openTab("agent", agent.id, agent.name)}
        >
          {agent.name}
        </DropdownItem>
      ))}
    </AdaptiveMenu>
  );
};
