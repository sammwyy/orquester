import React, { useState } from "react";
import type { RegistryEntry } from "@orquester/api";
import { ChevronRight, Copy, Download, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "../../../lib/cn";
import { Button, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, SegmentedControl } from "../../ui";
import { getRegistryIcon } from "../../../icons";
import { useApi } from "../../../context/orquester-context";
import { useRegistry } from "../../../hooks";
import { useAppStore } from "../../../store/app";
type AgentFilter = "all" | "installed" | "available";

const AgentInstallActions: React.FC<{
  agent: RegistryEntry;
  onInstall: (elevated?: boolean) => void;
}> = ({ agent, onInstall }) => {
  const [copied, setCopied] = useState(false);
  const command = agent.installCommand ?? "Installation command unavailable.";
  const blocked = agent.missingDependencies.length > 0;

  const copyCommand = async () => {
    if (!agent.installCommand) return;
    await navigator.clipboard?.writeText(agent.installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const trigger = (
    <span className="flex items-center gap-1 rounded-lg">
      <span
        role="button"
        tabIndex={blocked ? -1 : 0}
        aria-disabled={blocked}
        className={cn("inline-flex h-7 items-center gap-1 rounded-lg bg-blue-500 px-2 text-xs font-medium text-white", blocked && "cursor-not-allowed opacity-50")}
        onClick={(event) => { event.stopPropagation(); if (!blocked) onInstall(); }}
        onKeyDown={(event) => { if (!blocked && (event.key === "Enter" || event.key === " ")) onInstall(); }}
      >
        <Download size={13} /> {blocked ? `Missing ${agent.missingDependencies.join(", ")}` : "Install"}
      </span>
      <span className="inline-flex h-7 items-center rounded-lg border border-neutral-700 px-1.5 text-neutral-300" aria-label="Installation options">
        <ChevronRight size={13} className="rotate-90" />
      </span>
    </span>
  );

  return (
    <Dropdown trigger={trigger} align="right" width="w-72" side="left">
      <DropdownLabel>Installation options</DropdownLabel>
      <div className="mx-2 mb-2 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-neutral-600">Command preview</p>
        <code className="block break-all text-[11px] text-neutral-300">{command}</code>
      </div>
      <DropdownItem icon={<Copy size={14} />} disabled={!agent.installCommand} onClick={() => void copyCommand()}>
        {copied ? "Copied" : "Copy install command"}
      </DropdownItem>
      <DropdownItem icon={<ShieldCheck size={14} />} disabled={blocked} onClick={() => onInstall(true)}>
        Install as administrator
      </DropdownItem>
      {agent.websiteUrl && <>
        <DropdownSeparator />
        <DropdownItem icon={<ExternalLink size={14} />} onClick={() => window.open(agent.websiteUrl, "_blank", "noopener,noreferrer")}>
          Open official website
        </DropdownItem>
      </>}
    </Dropdown>
  );
};

export const AgentsSettings: React.FC = () => {
  const registry = useRegistry();
  const api = useApi();
  const installAgent = (id: string, elevated = false) => void api.installRegistryEntry(id, elevated);
  const updateAgent = useAppStore((s) => s.updateAgent);
  const [filter, setFilter] = useState<AgentFilter>("all");

  const agents = registry.agents.filter((a) =>
    filter === "installed" ? a.enabled : filter === "available" ? !a.enabled : true
  );

  const filters: { id: AgentFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "installed", label: "Installed" },
    { id: "available", label: "Available" }
  ];

  return (
    <div className="space-y-3">
      <SegmentedControl value={filter} options={filters} onChange={setFilter} />

      <div className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800/70">
        {agents.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-600">No agents in this view.</p>
        )}
        {agents.map((agent) => {
          const busy = agent.installState === "installing";
          const failed = agent.installState === "error";
          return (
            <div key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400">
                {getRegistryIcon("agent", agent.id, 18)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-100">{agent.name}</p>
                <p className="truncate text-xs text-neutral-500">
                  {busy
                    ? agent.enabled
                      ? "Updating…"
                      : "Installing…"
                      : failed
                        ? `Failed${agent.installError ? `: ${firstLine(agent.installError)}` : ""}`
                        : agent.missingDependencies.length > 0
                          ? `Missing ${agent.missingDependencies.join(", ")}`
                        : agent.enabled
                          ? agent.version ?? "installed"
                        : "Not installed"}
                </p>
              </div>
              <div className="shrink-0">
                {busy ? (
                  <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <Loader2 size={13} className="animate-spin" />
                    {agent.enabled ? "Updating…" : "Installing…"}
                  </span>
                ) : failed ? (
                  <AgentInstallActions agent={agent} onInstall={(elevated) => installAgent(agent.id, elevated)} />
                ) : agent.enabled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!agent.canUpdate}
                    onClick={() => void updateAgent(agent.id)}
                  >
                    <RefreshCw size={13} /> Update
                  </Button>
                ) : (
                  <AgentInstallActions agent={agent} onInstall={(elevated) => installAgent(agent.id, elevated)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "";
