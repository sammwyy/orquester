import React, { useState } from "react";
import { Check, Plus, Server, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, Input } from "../ui";
import { useAppStore } from "../../store/app";
import type { ConnectionStatus } from "../../types";

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-neutral-500 animate-pulse",
  disconnected: "bg-neutral-700",
  error: "bg-red-500"
};

/** Sidebar footer: shows the active daemon and switches/manages servers. */
export const ServerSwitcher: React.FC = () => {
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const status = useAppStore((s) => s.connectionStatus);
  const select = useAppStore((s) => s.selectConnection);
  const removeRemote = useAppStore((s) => s.removeRemote);
  const addRemote = useAppStore((s) => s.addRemote);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");

  const active = connections.find((c) => c.id === activeId);

  const submit = async () => {
    if (!url.trim()) {
      return;
    }
    const id = await addRemote({ name, baseUrl: url, password });
    setAdding(false);
    setName("");
    setUrl("");
    setPassword("");
    void select(id);
  };

  const trigger = (
    <span className="flex w-full items-center gap-2 px-1 py-0.5 text-left">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_COLOR[status])} />
      <span className="flex-1 truncate text-xs text-neutral-300">{active?.name ?? "No server"}</span>
      <Server size={13} className="text-neutral-600" />
    </span>
  );

  return (
    <div className="border-t border-neutral-800 p-2">
      <Dropdown trigger={trigger} width="w-64">
        <DropdownLabel>Servers</DropdownLabel>
        {connections.map((connection) => (
          <div key={connection.id} className="group flex items-center">
            <DropdownItem
              className="flex-1"
              icon={
                connection.id === activeId ? (
                  <Check size={14} />
                ) : (
                  <span className={cn("h-2 w-2 rounded-full", STATUS_COLOR[connection.status])} />
                )
              }
              onClick={() => void select(connection.id)}
            >
              <span className="truncate">{connection.name}</span>
            </DropdownItem>
            {connection.kind === "remote" && (
              <button
                type="button"
                aria-label="Remove server"
                className="mr-1 hidden h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-red-400 group-hover:flex"
                onClick={() => void removeRemote(connection.id)}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}

        <DropdownSeparator />

        {adding ? (
          <div className="space-y-1.5 p-1.5" onClick={(e) => e.stopPropagation()}>
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder="https://host:47831"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Token (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1" onClick={() => void submit()}>
                Add
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <DropdownItem icon={<Plus size={14} />} keepOpen onClick={() => setAdding(true)}>
            Add server…
          </DropdownItem>
        )}
      </Dropdown>
    </div>
  );
};
