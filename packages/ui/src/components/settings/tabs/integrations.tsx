import React, { useEffect, useState } from "react";
import type { IntegrationStatus } from "@orquester/api";
import { BatteryCharging, GitBranch, Music2, Network, PlugZap } from "lucide-react";
import { useApi } from "../../../context/orquester-context";
import { useAppStore } from "../../../store/app";
import { Switch } from "../../ui";
import { cn } from "../../../lib/cn";

const icons: Record<string, React.ReactNode> = {
  git: <GitBranch size={20} />,
  battery: <BatteryCharging size={20} />,
  media: <Music2 size={20} />,
  networking: <Network size={20} />
};

export const IntegrationsSettings: React.FC = () => {
  const api = useApi();
  const setStoreIntegrations = useAppStore((state) => state.setIntegrations);
  const connections = useAppStore((state) => state.connections);
  const activeConnectionId = useAppStore((state) => state.activeConnectionId);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const local = connections.find((connection) => connection.id === activeConnectionId)?.kind === "local";

  useEffect(() => {
    let active = true;
    api.getIntegrations()
      .then((response) => {
        if (active) {
          setIntegrations(response.integrations);
          setStoreIntegrations(response.integrations);
        }
      })
      .catch(() => { if (active) setMessage("Could not load integrations."); });
    return () => { active = false; };
  }, [api]);

  const toggle = async (id: string, enabled: boolean) => {
    if (!local) return;
    const next = integrations.map((integration) => integration.id === id ? { ...integration, enabled } : integration);
    setIntegrations(next);
    setMessage(null);
    try {
      const response = await api.updateIntegrations(Object.fromEntries(next.map((integration) => [integration.id, integration.enabled])));
      setIntegrations(response.integrations);
      setStoreIntegrations(response.integrations);
    } catch {
      setMessage("Could not save integration settings.");
      setIntegrations(integrations);
    }
  };

  return (
    <div className="space-y-3">
      {!local && (
        <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
          Integration settings are read-only while connected to a remote worker.
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {integrations.map((integration) => (
          <div key={integration.id} className="rounded-xl border border-neutral-800/70 bg-neutral-900/40 p-3">
            <div className="flex items-start gap-3">
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300", !integration.available && "opacity-40")}>
                {icons[integration.id] ?? <PlugZap size={20} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-100">{integration.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">{integration.description}</p>
                {!integration.available && <p className="mt-2 text-[11px] text-orange-300/80">{integration.unavailableReason ?? "Unavailable on this worker."}</p>}
              </div>
              <Switch checked={integration.enabled} disabled={!local || !integration.available} onChange={(enabled) => void toggle(integration.id, enabled)} />
            </div>
          </div>
        ))}
      </div>
      {integrations.length === 0 && <p className="text-sm text-neutral-500">No integrations available.</p>}
      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}
    </div>
  );
};
