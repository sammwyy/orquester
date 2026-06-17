import React from "react";
import { Bot, FolderTree, Plus, TerminalSquare } from "lucide-react";
import { Dropdown, DropdownEmpty, DropdownItem, DropdownLabel, DropdownSeparator, IconButton } from "../ui";
import { useAgents } from "../../hooks";
import { useAppStore } from "../../store/app";

/**
 * The "+" new-tab button. Opens a categorized menu: installed Agents (or a
 * "No installed agents" placeholder) and built-in Tools.
 */
export const NewTabMenu: React.FC = () => {
  const addTab = useAppStore((s) => s.addTab);
  const { data: agents, loading } = useAgents();

  return (
    <Dropdown
      trigger={
        <IconButton label="New tab" className="app-no-drag">
          <Plus size={16} />
        </IconButton>
      }
      width="w-56"
    >
      <DropdownLabel>Agents</DropdownLabel>
      {loading && <DropdownEmpty>Loading…</DropdownEmpty>}
      {!loading && agents.length === 0 && <DropdownEmpty>No installed agents</DropdownEmpty>}
      {agents.map((agent) => (
        <DropdownItem
          key={agent.id}
          icon={<Bot size={14} />}
          disabled={!agent.installed}
          onClick={() => addTab("agent", { title: agent.name, agentId: agent.id })}
        >
          {agent.name}
        </DropdownItem>
      ))}

      <DropdownSeparator />

      <DropdownLabel>Tools</DropdownLabel>
      <DropdownItem icon={<TerminalSquare size={14} />} onClick={() => addTab("terminal")}>
        Terminal
      </DropdownItem>
      <DropdownItem icon={<FolderTree size={14} />} onClick={() => addTab("files")}>
        File Explorer
      </DropdownItem>
    </Dropdown>
  );
};
