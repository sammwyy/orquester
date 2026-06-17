import React from "react";
import { Download, FolderTree, Plus } from "lucide-react";
import {
  Dropdown,
  DropdownEmpty,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  IconButton
} from "../ui";
import { getRegistryIcon } from "../../icons";
import { useRegistry } from "../../hooks";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

/**
 * The "+" new-tab button. Lists detected shells and agents from the daemon
 * registry; choosing one opens a live session (tab) in the current project.
 * Disabled agents offer a one-click install instead.
 */
export const NewTabMenu: React.FC = () => {
  const openTab = useAppStore((s) => s.openTab);
  const openFileBrowser = useAppStore((s) => s.openFileBrowser);
  const api = useApi();
  const { data: registry, loading, reload } = useRegistry();

  const enabledShells = registry.shells.filter((s) => s.enabled);
  const agents = registry.agents;

  return (
    <Dropdown
      trigger={
        <IconButton label="New tab" className="app-no-drag">
          <Plus size={16} />
        </IconButton>
      }
      width="w-60"
    >
      <DropdownLabel>Shells</DropdownLabel>
      {loading && <DropdownEmpty>Loading…</DropdownEmpty>}
      {!loading && enabledShells.length === 0 && <DropdownEmpty>No shells detected</DropdownEmpty>}
      {enabledShells.map((shell) => (
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
      <DropdownItem icon={<FolderTree size={14} />} onClick={() => openFileBrowser()}>
        File Browser
      </DropdownItem>

      <DropdownSeparator />

      <DropdownLabel>Agents</DropdownLabel>
      {!loading && agents.length === 0 && <DropdownEmpty>No agents</DropdownEmpty>}
      {agents.map((agent) =>
        agent.enabled ? (
          <DropdownItem
            key={agent.id}
            icon={getRegistryIcon("agent", agent.id, 14)}
            onClick={() => void openTab("agent", agent.id, agent.name)}
          >
            {agent.name}
          </DropdownItem>
        ) : (
          <DropdownItem
            key={agent.id}
            icon={<Download size={14} />}
            keepOpen
            disabled={!agent.installCmd}
            onClick={() => {
              void api.installRegistryEntry(agent.id).then(() => reload());
            }}
          >
            <span className="text-neutral-500">{agent.name}</span>
            <span className="ml-1 text-[10px] text-neutral-600">install</span>
          </DropdownItem>
        )
      )}
    </Dropdown>
  );
};
