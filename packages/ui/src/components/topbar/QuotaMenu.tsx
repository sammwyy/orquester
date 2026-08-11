import React, { useEffect, useState } from "react";
import { Gauge, Loader2, RefreshCw } from "lucide-react";
import type { QuotaWindow, RegistryQuota } from "@orquester/api";
import { AdaptiveMenu } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useRegistry } from "../../hooks";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

const relativeReset = (window: QuotaWindow, now: Date): string => {
  if (!window.resetsAt) return window.resetLabel ?? "unknown";
  const timestamp = new Date(window.resetsAt).getTime();
  if (Number.isNaN(timestamp)) return window.resetLabel ?? "unknown";
  const minutes = Math.max(0, Math.ceil((timestamp - now.getTime()) / 60_000));
  if (minutes === 0) return "now";
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  return `in ${[days ? `${days}d` : "", hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ")}`;
};

const percent = (window: QuotaWindow): number | undefined => {
  if (window.percentUsed !== undefined) return Math.max(0, Math.min(100, window.percentUsed));
  if (window.used !== undefined && window.limit) return Math.max(0, Math.min(100, (window.used / window.limit) * 100));
  return undefined;
};

const QuotaRow: React.FC<{ quota: RegistryQuota; now: Date }> = ({ quota, now }) => (
  <div className="rounded-lg bg-neutral-950/45 px-2.5 py-2">
    <div className="mb-1.5 flex items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-300">
        {getRegistryIcon("agent", quota.id, 15)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">{quota.provider}</span>
      {!quota.supported && <span className="text-[10px] text-neutral-600">Not supported</span>}
    </div>
    {quota.windows.length > 0 ? quota.windows.map((window) => {
      const used = percent(window);
      const color = used === undefined ? "bg-neutral-700" : used > 85 ? "bg-red-400/80" : used > 60 ? "bg-amber-300/80" : "bg-sky-400/70";
      return (
        <div key={window.id} className="mt-2 first:mt-0">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-neutral-500">
            <span>{window.label}</span>
            <span className="tabular-nums text-neutral-300">{used === undefined ? "—" : `${Math.round(used)}%`} · Resets {relativeReset(window, now)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${used ?? 0}%` }} />
          </div>
        </div>
      );
    }) : <p className="pl-7 text-[10px] text-neutral-600">{quota.message ?? "No quota windows"}</p>}
  </div>
);

const LoadingRow: React.FC<{ name: string; id: string }> = ({ name, id }) => (
  <div className="flex items-center gap-2 rounded-lg bg-neutral-950/35 px-2.5 py-2">
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500">{getRegistryIcon("agent", id, 15)}</span>
    <span className="flex-1 text-xs text-neutral-400">{name}</span>
    <Loader2 size={12} className="animate-spin text-neutral-600" />
  </div>
);

export const QuotaMenu: React.FC = () => {
  const api = useApi();
  const agents = useRegistry().agents.filter((agent) => agent.enabled);
  const show = useAppStore((state) => state.appConfig.showQuotaMenu);
  const cachedQuotas = useAppStore((state) => state.quotaById);
  const setQuota = useAppStore((state) => state.setQuota);
  const [quotas, setQuotas] = useState<Record<string, RegistryQuota>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const installedKey = agents.map((agent) => agent.id).join(",");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open || Date.now() - lastLoaded < 60_000) return;
    const current = agents.map((agent) => agent.id);
    setLastLoaded(Date.now());
    setLoading(new Set(current));
    for (const id of current) {
      void api.registryQuota(id)
        .then((quota) => {
          setQuota(quota);
          setQuotas((previous) => ({ ...previous, [id]: quota }));
        })
        .catch(() => {
          const quota: RegistryQuota = {
            id,
            provider: agents.find((agent) => agent.id === id)?.name ?? id,
            auth: { status: "unknown" },
            supported: false,
            fetchedAt: new Date().toISOString(),
            windows: [],
            message: "Could not load quota."
          };
          setQuota(quota);
          setQuotas((previous) => ({ ...previous, [id]: quota }));
        })
        .finally(() => setLoading((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        }));
    }
  }, [api, open, installedKey, lastLoaded]);

  if (!show) return null;

  const trigger = (
    <span className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-800">
      <Gauge size={13} className="text-neutral-500" />
      <span className="hidden sm:inline">Quota</span>
    </span>
  );

  return (
    <AdaptiveMenu title="Quota" trigger={trigger} align="right" width="w-80" onOpenChange={setOpen}>
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <div>
          <p className="text-xs font-medium text-neutral-200">Agent quota</p>
          <p className="text-[10px] text-neutral-600">Refreshes every 30 seconds</p>
        </div>
        <RefreshCw size={13} className="text-neutral-600" />
      </div>
      <div className="space-y-1.5">
        {agents.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-neutral-600">No installed agents found.</p>}
        {agents.map((agent) => {
          const quota = cachedQuotas[agent.id] ?? quotas[agent.id];
          if (quota && !quota.supported) return null;
          return loading.has(agent.id) && !quota
            ? <LoadingRow key={agent.id} name={agent.name} id={agent.id} />
            : quota
              ? <QuotaRow key={agent.id} quota={quota} now={now} />
              : <LoadingRow key={agent.id} name={agent.name} id={agent.id} />;
        })}
        {!loading.size && agents.length > 0 && Object.values(quotas).every((quota) => !quota.supported) && (
          <p className="px-2 py-3 text-center text-[11px] text-neutral-600">No supported quota providers.</p>
        )}
      </div>
    </AdaptiveMenu>
  );
};
