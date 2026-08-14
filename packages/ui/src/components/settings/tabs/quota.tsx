import React, { useEffect, useState } from "react";
import type { RegistryQuota, QuotaWindow } from "@orquester/api";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "../../../lib/cn";
import { Button, SegmentedControl, Switch } from "../../ui";
import { getRegistryIcon } from "../../../icons";
import { useApi } from "../../../context/orquester-context";
import { useRegistry } from "../../../hooks";
import { useAppStore } from "../../../store/app";
const quotaPercent = (window: QuotaWindow): number | undefined => {
  if (window.percentUsed !== undefined) return Math.max(0, Math.min(100, window.percentUsed));
  if (window.used !== undefined && window.limit !== undefined && window.limit > 0) {
    return Math.max(0, Math.min(100, (window.used / window.limit) * 100));
  }
  return undefined;
};

const formatAmount = (value: number | undefined, unit: QuotaWindow["unit"]): string => {
  if (value === undefined) return "—";
  return `${new Intl.NumberFormat().format(value)}${unit === "tokens" ? " tokens" : unit === "requests" ? " requests" : unit === "credits" ? " credits" : ""}`;
};

const formatRemaining = (window: QuotaWindow): string => {
  if (window.remaining === undefined) return window.limit !== undefined ? `Limit: ${formatAmount(window.limit, window.unit)}` : "Limit unknown";
  const amount = formatAmount(window.remaining, window.unit);
  return `${amount}${window.percentUsed !== undefined && window.unit === "unknown" ? "%" : ""} remaining`;
};

const formatReset = (value: string | undefined): string => {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

type QuotaResetFormat = "relative" | "absolute" | "both";

const formatRelativeReset = (value: string | undefined, now: Date): string | undefined => {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return undefined;
  const totalMinutes = Math.max(0, Math.ceil((timestamp - now.getTime()) / 60_000));
  if (totalMinutes === 0) return "now";
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ");
};

const resetDisplay = (window: QuotaWindow, format: QuotaResetFormat, now: Date): string => {
  const absolute = window.resetsAt ? formatReset(window.resetsAt) : undefined;
  const fallback = window.resetLabel ?? "unknown";
  const relative = formatRelativeReset(window.resetsAt, now);
  if (format === "absolute") return absolute ?? fallback;
  if (format === "both") return relative ? `in ${relative} · ${absolute ?? fallback}` : fallback;
  return relative ? `in ${relative}` : fallback;
};

const QuotaWindowView: React.FC<{ window: QuotaWindow; resetFormat: QuotaResetFormat; now: Date }> = ({ window, resetFormat, now }) => {
  const percent = quotaPercent(window);
  const color = percent === undefined ? "bg-neutral-700" : percent > 85 ? "bg-red-400/90" : percent > 60 ? "bg-amber-300/90" : "bg-sky-400/80";
  return (
    <div className="space-y-1.5 rounded-lg bg-neutral-950/45 px-2.5 py-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0">
          <span className="block truncate text-xs font-medium text-neutral-200">{window.label}</span>
        </div>
        <span className={cn("shrink-0 text-sm font-medium tabular-nums", percent === undefined ? "text-neutral-500" : percent > 85 ? "text-red-300" : percent > 60 ? "text-amber-200" : "text-neutral-200")}>
          {percent === undefined ? formatAmount(window.used, window.unit) : `${Math.round(percent)}%`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800/90">
        <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${percent ?? 0}%` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        <span>{formatRemaining(window)}</span>
        <span>Reset {resetDisplay(window, resetFormat, now)}</span>
      </div>
    </div>
  );
};

const QuotaCard: React.FC<{
  quota: RegistryQuota;
  resetFormat: QuotaResetFormat;
  now: Date;
  workerEnabled: boolean;
  onWorkerChange: (enabled: boolean) => void;
  disabled: boolean;
}> = ({ quota, resetFormat, now, workerEnabled, onWorkerChange, disabled }) => (
  <article className="overflow-hidden rounded-2xl border border-neutral-800/75 bg-neutral-900/70 shadow-xl shadow-black/10">
    <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-200 ring-1 ring-white/[0.04]">
        {getRegistryIcon("agent", quota.id, 21)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-100">{quota.provider}</p>
        <p className="truncate text-xs text-neutral-500">
          {quota.supported
            ? [quota.auth.account, quota.auth.status === "authenticated" ? quota.auth.message : undefined].filter(Boolean).join(" · ") || "Usage and rate limits"
            : "Not supported"}
        </p>
      </div>
      <Switch checked={workerEnabled} disabled={disabled} onChange={onWorkerChange} />
    </div>
    <div className="space-y-2.5 px-2.5 pb-2.5">
      {quota.windows.length > 0 ? quota.windows.map((window) => <QuotaWindowView key={window.id} window={window} resetFormat={resetFormat} now={now} />) : (
        <div className="rounded-lg bg-neutral-950/35 px-3 py-3 text-center text-xs text-neutral-600">{quota.message ?? "No quota windows reported yet."}</div>
      )}
    </div>
  </article>
);

export const QuotaSettings: React.FC = () => {
  const api = useApi();
  const agents = useRegistry().agents;
  const [quotas, setQuotas] = useState<RegistryQuota[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const resetFormat = useAppStore((state) => state.appConfig.quotaResetFormat);
  const updateAppConfig = useAppStore((state) => state.updateAppConfig);
  const cachedQuotas = useAppStore((state) => state.quotaById);
  const setQuota = useAppStore((state) => state.setQuota);
  const connections = useAppStore((state) => state.connections);
  const activeConnectionId = useAppStore((state) => state.activeConnectionId);
  const isLocal = connections.find((connection) => connection.id === activeConnectionId)?.kind === "local";
  const [canEdit, setCanEdit] = useState(isLocal);
  const [quotaWorkers, setQuotaWorkers] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => new Date());
  const installedIds = agents.filter((agent) => agent.enabled).map((agent) => agent.id);
  const installedKey = installedIds.join(",");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    api.getDaemonConfig().then((config) => {
      if (active) {
        setQuotaWorkers(config.quotaWorkers);
        setCanEdit(isLocal || config.transports.http.allowRemoteAdmin);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [api]);

  const updateQuotaWorker = async (id: string, enabled: boolean) => {
    const previous = quotaWorkers;
    const next = { ...previous, [id]: enabled };
    setQuotaWorkers(next);
    try {
      const config = await api.updateDaemonConfig({ quotaWorkers: next });
      setQuotaWorkers(config.quotaWorkers);
    } catch {
      setQuotaWorkers(previous);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (!installedIds.length) {
      setQuotas([]);
      setLoading(false);
      return () => { active = false; };
    }
    Promise.all(
      installedIds.map(async (id) => {
        try {
          const quota = await api.registryQuota(id);
          setQuota(quota);
          return quota;
        } catch {
          return {
            id,
            provider: agents.find((agent) => agent.id === id)?.name ?? id,
            auth: { status: "unknown" as const, message: "Could not contact the daemon." },
            supported: false,
            fetchedAt: new Date().toISOString(),
            windows: [],
            message: "Could not load quota information."
          } satisfies RegistryQuota;
        }
      })
    ).then((next) => {
      if (active) setQuotas(next);
    }).catch(() => {
      if (active) setError("Could not load quota information.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, installedKey, refreshToken]);

  const merged = new Map<string, RegistryQuota>();
  for (const quota of quotas) merged.set(quota.id, quota);
  for (const quota of Object.values(cachedQuotas)) merged.set(quota.id, quota);
  const ordered = [...merged.values()].sort((a, b) => {
    const score = (quota: RegistryQuota) => quota.auth.status === "authenticated" && quota.supported ? 0 : quota.auth.status === "authenticated" ? 1 : 2;
    return score(a) - score(b) || a.provider.localeCompare(b.provider);
  });
  const unavailable = ordered.filter((quota) => quota.auth.status !== "authenticated" || !quota.supported);
  const available = ordered.filter((quota) => !unavailable.includes(quota));
  const resetOptions: { id: QuotaResetFormat; label: string }[] = [
    { id: "relative", label: "Relative" },
    { id: "absolute", label: "Exact" },
    { id: "both", label: "Both" }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-200">Agent quota</p>
          <p className="text-xs text-neutral-500">Usage is read from the active daemon and never stores credentials.</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl value={resetFormat} options={resetOptions} onChange={(value) => void updateAppConfig({ quotaResetFormat: value })} />
          <Button size="sm" variant="outline" disabled={loading} onClick={() => setRefreshToken((value) => value + 1)}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-amber-400">{error}</p>}
      {!loading && quotas.length === 0 && <p className="rounded-xl border border-neutral-800/70 px-3 py-4 text-sm text-neutral-500">No installed agents found.</p>}
      {available.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Available quota</h3>
          <div className="columns-1 gap-2.5 sm:columns-2">
            {available.map((quota) => (
              <div key={quota.id} className="mb-2.5 break-inside-avoid">
                <QuotaCard quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!canEdit} />
              </div>
            ))}
          </div>
        </section>
      )}
      {unavailable.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Needs authentication or provider support</h3>
          <div className="columns-1 gap-2.5 sm:columns-2">
            {unavailable.map((quota) => (
              <div key={quota.id} className="mb-2.5 break-inside-avoid">
                <QuotaCard quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!canEdit} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
