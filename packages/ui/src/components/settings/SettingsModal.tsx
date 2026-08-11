import React, { useEffect, useState } from "react";
import {
  AppWindow,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Gauge,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Server,
  Sun
} from "lucide-react";
import type { RegistryQuota, QuotaWindow } from "@orquester/api";
import type { DaemonConfig } from "@orquester/config";
import { COLOR_SCHEMES, THEME_MODES } from "../../lib/theme";
import type { BlurStrategy, ThemeMode } from "../../types";
import { cn } from "../../lib/cn";
import { Button, Input, Modal, ModalCloseButton, OptionCard, SegmentedControl, Slider, Switch } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useIsDesktop, useRegistry } from "../../hooks";
import { useApi, useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

type Section = "app" | "appearance" | "daemon" | "agents" | "quota";
/** Client settings live in this window; server settings belong to the daemon. */
type SectionGroup = "client" | "server";

const GROUPS: { id: SectionGroup; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "server", label: "Server" }
];

const SECTIONS: {
  id: Section;
  group: SectionGroup;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
    {
      id: "app",
      group: "client",
      label: "App",
      icon: <AppWindow size={16} />,
      desc: "Window behaviour, runtime, active server"
    },
    {
      id: "appearance",
      group: "client",
      label: "Appearance",
      icon: <Palette size={16} />,
      desc: "Titlebar and sidebar look"
    },
    {
      id: "daemon",
      group: "server",
      label: "Daemon",
      icon: <Server size={16} />,
      desc: "Workspaces dir, external HTTP access"
    },
    {
      id: "agents",
      group: "server",
      label: "Agents",
      icon: <Boxes size={16} />,
      desc: "Install, update and view harness versions"
    },
    {
      id: "quota",
      group: "server",
      label: "Quota",
      icon: <Gauge size={16} />,
      desc: "Usage windows, limits and authentication"
    }
  ];

const sectionsOf = (group: SectionGroup) => SECTIONS.filter((s) => s.group === group);

const renderSection = (id: Section) =>
  id === "app" ? (
    <AppSettings />
  ) : id === "appearance" ? (
    <AppearanceSettings />
  ) : id === "daemon" ? (
    <DaemonSettings />
  ) : id === "quota" ? (
    <QuotaSettings />
  ) : (
    <AgentsSettings />
  );
const labelOf = (id: Section) => SECTIONS.find((s) => s.id === id)?.label ?? "";

export const SettingsModal: React.FC = () => {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const isDesktop = useIsDesktop();
  const [section, setSection] = useState<Section | null>(null);

  // Reset to the category list each time it closes (mobile shows list first).
  useEffect(() => {
    if (!open) {
      setSection(null);
    }
  }, [open]);

  const close = () => setOpen(false);

  // --- Desktop: persistent side nav + content ---
  if (isDesktop) {
    const current = section ?? "app";
    return (
      <Modal open={open} onClose={close} className="h-[85vh] max-w-4xl">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-neutral-800/70 bg-neutral-950/30 p-2">
          {GROUPS.map((group) => (
            <React.Fragment key={group.id}>
              <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-neutral-500 first:pt-1">
                {group.label}
              </p>
              {sectionsOf(group.id).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    current === s.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/60"
                  )}
                >
                  <span className="text-neutral-500">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800/70 px-4">
            <span className="text-sm font-medium text-neutral-100">{labelOf(current)}</span>
            <ModalCloseButton onClose={close} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{renderSection(current)}</div>
        </div>
      </Modal>
    );
  }

  // --- Mobile: category list → detail with a back button ---
  return (
    <Modal open={open} onClose={close} className="h-[88vh]">
      <div className="flex w-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-800/70 px-2">
          {section ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => setSection(null)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-neutral-800"
            >
              <ChevronLeft size={18} />
            </button>
          ) : (
            <span className="px-2" />
          )}
          <span className="flex-1 text-sm font-medium text-neutral-100">
            {section ? labelOf(section) : "Settings"}
          </span>
          <ModalCloseButton onClose={close} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === null ? (
            <div className="p-2">
              {GROUPS.map((group) => (
                <div key={group.id} className="mb-2 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {group.label}
                  </p>
                  {sectionsOf(group.id).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSection(s.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-neutral-800/60"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
                        {s.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-neutral-100">{s.label}</span>
                        <span className="block truncate text-xs text-neutral-500">{s.desc}</span>
                      </span>
                      <ChevronRight size={16} className="text-neutral-600" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">{renderSection(section)}</div>
          )}
        </div>
      </div>
    </Modal>
  );
};

/** iOS-style grouped list: a small caption over a rounded card of rows. */
const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-1.5">
    <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
      {title}
    </h3>
    <div className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800/70 bg-neutral-900/40 px-3">
      {children}
    </div>
  </section>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="flex items-center justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <p className="text-sm text-neutral-200">{label}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/** Field whose control needs the full width (option grids, sliders). */
const StackedField: React.FC<{ label?: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="space-y-2.5 py-3">
    {(label || hint) && (
      <div className="min-w-0">
        {label && <p className="text-sm text-neutral-200">{label}</p>}
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
    )}
    {children}
  </div>
);

type AgentFilter = "all" | "installed" | "available";

const AgentsSettings: React.FC = () => {
  const registry = useRegistry();
  const installAgent = useAppStore((s) => s.installAgent);
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
                  <Button size="sm" variant="outline" onClick={() => void installAgent(agent.id)}>
                    <RefreshCw size={13} /> Retry
                  </Button>
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
                  <Button size="sm" disabled={!agent.canInstall} onClick={() => void installAgent(agent.id)}>
                    <Download size={13} /> Install
                  </Button>
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

const QuotaSettings: React.FC = () => {
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
      if (active) setQuotaWorkers(config.quotaWorkers);
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
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{available.map((quota) => <QuotaCard key={quota.id} quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!isLocal} />)}</div>
        </section>
      )}
      {unavailable.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">Needs authentication or provider support</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{unavailable.map((quota) => <QuotaCard key={quota.id} quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!isLocal} />)}</div>
        </section>
      )}
    </div>
  );
};

const AppSettings: React.FC = () => {
  const { runtime } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const active = connections.find((c) => c.id === activeId);

  return (
    <div className="space-y-6">
      {runtime === "desktop" && (
        <Group title="Behaviour">
          <Field
            label="Run in background"
            hint="Closing the window keeps the daemon running in the tray."
          >
            <Switch
              checked={appConfig.runInBackground}
              onChange={(checked) => void updateAppConfig({ runInBackground: checked })}
            />
          </Field>
        </Group>
      )}

      <Group title="About">
        <Field label="Runtime">
          <span className="text-sm text-neutral-400">{runtime}</span>
        </Field>
        <Field label="Active server">
          <span className="text-sm text-neutral-400">{active?.name ?? "—"}</span>
        </Field>
      </Group>
    </div>
  );
};

const BLUR_HINT: Record<BlurStrategy, string> = {
  vibrancy: "Blurred by macOS vibrancy.",
  acrylic: "Blurred by Windows acrylic.",
  kwin: "Blurred by KWin."
};

const MODE_ICON: Record<ThemeMode, React.ReactNode> = {
  system: <Monitor size={13} />,
  light: <Sun size={13} />,
  dark: <Moon size={13} />,
  dynamic: <Clock size={13} />
};

/**
 * A miniature of the app painted with a theme's own variables — the same
 * `[data-scheme][data-mode]` selectors the real chrome uses, so a preview can
 * never drift from the theme it advertises.
 */
const ThemePreview: React.FC<{ scheme: string; mode: "light" | "dark" }> = ({ scheme, mode }) => (
  <span data-scheme={scheme} data-mode={mode} className="flex h-14 w-full bg-neutral-950">
    <span className="flex h-full w-1/3 flex-col gap-1 bg-neutral-900 p-1.5">
      <span className="h-1 w-full rounded-full bg-neutral-700" />
      <span className="h-1 w-3/4 rounded-full bg-neutral-800" />
      <span className="h-1 w-2/3 rounded-full bg-neutral-800" />
    </span>
    <span className="flex h-full flex-1 flex-col gap-1 p-1.5">
      <span className="h-1.5 w-1/2 rounded-full bg-neutral-300" />
      <span className="h-1 w-full rounded-full bg-neutral-700" />
      <span className="h-1 w-4/5 rounded-full bg-neutral-800" />
    </span>
  </span>
);

const AppearanceSettings: React.FC = () => {
  const { runtime, windowControls } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const capabilities = useAppStore((s) => s.windowCapabilities);
  const resolvedMode = useAppStore((s) => s.resolvedMode);
  const drawsCorners = Boolean(windowControls?.cssRoundedCorners);
  const desktop = runtime === "desktop";
  const canBlur = capabilities.blur !== null;
  const transparent = appConfig.sidebarTransparent && capabilities.transparency;

  return (
    <div className="space-y-6">
      <Group title="Theme">
        <StackedField>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLOR_SCHEMES.map((scheme) => (
              <OptionCard
                key={scheme.id}
                label={scheme.label}
                selected={appConfig.theme === scheme.id}
                onSelect={() => void updateAppConfig({ theme: scheme.id })}
              >
                <ThemePreview scheme={scheme.id} mode={resolvedMode} />
              </OptionCard>
            ))}
          </div>
        </StackedField>

        <StackedField
          label="Appearance"
          hint="System follows the OS; Dynamic follows the time of day."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {THEME_MODES.map((mode) => (
              <OptionCard
                key={mode.id}
                label={mode.label}
                selected={appConfig.themeMode === mode.id}
                onSelect={() => void updateAppConfig({ themeMode: mode.id })}
              >
                <span className="relative block">
                  <ThemePreview
                    scheme={appConfig.theme}
                    mode={mode.id === "light" ? "light" : mode.id === "dark" ? "dark" : resolvedMode}
                  />
                  <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900/80 text-neutral-300 backdrop-blur">
                    {MODE_ICON[mode.id]}
                  </span>
                </span>
              </OptionCard>
            ))}
          </div>
        </StackedField>
      </Group>

      {desktop && (
        <Group title="Sidebar">
          <Field
            label="Transparent"
            hint={
              capabilities.transparency
                ? "Let the desktop show through the sidebar."
                : "This window can't show what's behind it."
            }
          >
            <Switch
              checked={transparent}
              disabled={!capabilities.transparency}
              onChange={(checked) => void updateAppConfig({ sidebarTransparent: checked })}
            />
          </Field>

          <StackedField label="Opacity">
            <div className="flex items-center gap-3">
              <Slider
                min={0.3}
                max={1}
                step={0.05}
                value={appConfig.sidebarOpacity}
                disabled={!transparent}
                onChange={(value) => void updateAppConfig({ sidebarOpacity: value })}
              />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                {Math.round(appConfig.sidebarOpacity * 100)}%
              </span>
            </div>
          </StackedField>

          <Field
            label="Glass blur"
            hint={
              canBlur
                ? (capabilities.blur && BLUR_HINT[capabilities.blur]) ?? ""
                : "No window blur here — needs macOS, Windows 11 or KDE/KWin."
            }
          >
            <Switch
              checked={appConfig.glassSidebar && canBlur}
              disabled={!canBlur || !transparent}
              onChange={(checked) => void updateAppConfig({ glassSidebar: checked })}
            />
          </Field>
        </Group>
      )}

      <Group title="Window">
        <Field label="Custom titlebar" hint="Frameless window with in-app window controls.">
          <Switch
            checked={appConfig.useTitlebar}
            onChange={(checked) => void updateAppConfig({ useTitlebar: checked })}
          />
        </Field>
        {desktop && (
          <Field
            label="Rounded corners"
            hint={
              drawsCorners
                ? "Rounded while the window floats; square when maximized."
                : "This platform rounds frameless windows itself."
            }
          >
            <Switch
              checked={appConfig.roundedWindow && drawsCorners}
              disabled={!drawsCorners}
              onChange={(checked) => void updateAppConfig({ roundedWindow: checked })}
            />
          </Field>
        )}
      </Group>

      <Group title="Titlebar">
        <Field
          label="Show quota menu"
          hint="Adds a compact live quota menu beside Settings."
        >
          <Switch
            checked={appConfig.showQuotaMenu}
            onChange={(checked) => void updateAppConfig({ showQuotaMenu: checked })}
          />
        </Field>
      </Group>
    </div>
  );
};

const DaemonSettings: React.FC = () => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";

  const [workspacesDir, setWorkspacesDir] = useState("");
  const [httpEnabled, setHttpEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setWorkspacesDir(config.workspacesDir);
        setHttpEnabled(config.transports.http.enabled);
        setHost(config.transports.http.host);
        setPort(String(config.transports.http.port));
      })
      .catch(() => setMessage("Could not load daemon config."));
    return () => {
      active = false;
    };
  }, [api]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateDaemonConfig({
        workspacesDir,
        transports: {
          http: {
            enabled: httpEnabled,
            host,
            port: Number(port) || 47831,
            ...(password ? { password } : {})
          }
        }
      });
      setPassword("");
      setMessage("Saved. Transport changes apply after a daemon restart.");
    } catch {
      setMessage("Failed to save (daemon config is editable only over the local socket).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {!isLocal && (
        <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
          Daemon settings can only be changed from the local app (unix socket). Connected over HTTP
          they are read-only.
        </div>
      )}

      <Group title="Storage">
        <Field label="Workspaces directory" hint="Supports $userhome / $appdir variables.">
          <Input
            className="w-40 sm:w-64"
            value={workspacesDir}
            disabled={!isLocal}
            onChange={(e) => setWorkspacesDir(e.target.value)}
          />
        </Field>
      </Group>

      <Group title="External access">
        <Field label="HTTP transport" hint="Expose the daemon to remote clients (token-gated).">
          <Switch checked={httpEnabled} disabled={!isLocal} onChange={setHttpEnabled} />
        </Field>

        {httpEnabled && (
          <>
            <Field label="Host">
              <Input
                className="w-40 sm:w-64"
                value={host}
                disabled={!isLocal}
                onChange={(e) => setHost(e.target.value)}
              />
            </Field>
            <Field label="Port">
              <Input
                className="w-40 sm:w-64"
                value={port}
                disabled={!isLocal}
                onChange={(e) => setPort(e.target.value)}
              />
            </Field>
            <Field label="Password" hint="Min 8 chars. Leave blank to keep current.">
              <Input
                className="w-40 sm:w-64"
                type="password"
                placeholder="••••••••"
                value={password}
                disabled={!isLocal}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        )}
      </Group>

      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}

      {isLocal && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save daemon config"}
        </Button>
      )}
    </div>
  );
};
