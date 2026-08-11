import React, { useEffect, useState } from "react";
import {
  AppWindow,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  Globe2,
  HardDrive,
  Loader2,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trash2
} from "lucide-react";
import type { RegistryEntry, RegistryQuota, QuotaWindow } from "@orquester/api";
import type { DaemonConfig } from "@orquester/config";
import type { ApiClient } from "../../lib/api-client";
import { COLOR_SCHEMES, THEME_MODES } from "../../lib/theme";
import type { BlurStrategy, ThemeMode } from "../../types";
import { cn } from "../../lib/cn";
import { Button, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, Input, Modal, ModalCloseButton, OptionCard, SegmentedControl, Slider, Switch } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useIsDesktop, useRegistry } from "../../hooks";
import { useApi, useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

type Section =
  | "app"
  | "appearance"
  | "local-access"
  | "workers"
  | "storage"
  | "access"
  | "agents"
  | "quota";
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
      id: "local-access",
      group: "client",
      label: "Local Access",
      icon: <Server size={16} />,
      desc: "Let other devices reach this worker"
    },
    {
      id: "workers",
      group: "client",
      label: "Remote Workers",
      icon: <Globe2 size={16} />,
      desc: "Connect to workers on other machines"
    },
    {
      id: "storage",
      group: "server",
      label: "Storage",
      icon: <HardDrive size={16} />,
      desc: "Workspace directory"
    },
    {
      id: "access",
      group: "server",
      label: "Access",
      icon: <Globe2 size={16} />,
      desc: "How the selected worker is reached"
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

const renderSection = (id: Section, onGoToLocalAccess?: () => void) =>
  id === "app" ? (
    <AppSettings />
  ) : id === "appearance" ? (
    <AppearanceSettings />
  ) : id === "local-access" ? (
    <LocalAccessSettings />
  ) : id === "workers" ? (
    <RemoteWorkersSettings />
  ) : id === "storage" ? (
    <StorageSettings />
  ) : id === "access" ? (
    <AccessSettings onGoToLocalAccess={onGoToLocalAccess} />
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
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {renderSection(current, () => setSection("local-access"))}
          </div>
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
            <div className="p-4">{renderSection(section, () => setSection("local-access"))}</div>
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

const SectionHeading: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="flex items-baseline justify-between gap-4 px-1">
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
    <p className="text-right text-[11px] text-neutral-600">{description}</p>
  </div>
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

const AgentsSettings: React.FC = () => {
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
          <div className="columns-1 gap-2.5 sm:columns-2">
            {available.map((quota) => (
              <div key={quota.id} className="mb-2.5 break-inside-avoid">
                <QuotaCard quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!isLocal} />
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
                <QuotaCard quota={quota} resetFormat={resetFormat} now={now} workerEnabled={quotaWorkers[quota.id] !== false} onWorkerChange={(enabled) => void updateQuotaWorker(quota.id, enabled)} disabled={!isLocal} />
              </div>
            ))}
          </div>
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

const RemoteWorkersSettings: React.FC = () => {
  const connections = useAppStore((s) => s.connections);
  const addRemote = useAppStore((s) => s.addRemote);
  const removeRemote = useAppStore((s) => s.removeRemote);
  const selectConnection = useAppStore((s) => s.selectConnection);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");

  const submit = async () => {
    if (!url.trim()) {
      return;
    }
    const id = await addRemote({ name, baseUrl: url, password });
    setAdding(false);
    setName("");
    setUrl("");
    setPassword("");
    await selectConnection(id);
  };

  return (
    <div className="space-y-6">
      <Group title="Workers">
        {connections.map((connection) => (
          <div key={connection.id} className="flex items-center gap-3 py-3">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                connection.kind === "local" ? "bg-neutral-800 text-neutral-400" : "bg-neutral-800/70 text-neutral-500"
              )}
            >
              {connection.kind === "local" ? <LockKeyhole size={14} /> : <Globe2 size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-200">{connection.name}</span>
              <span className="block truncate text-xs text-neutral-500">
                {connection.kind === "local" ? "This device · always available" : connection.endpoint}
              </span>
            </span>
            {connection.kind === "local" ? (
              <span className="shrink-0 text-[11px] text-neutral-600">Local</span>
            ) : (
              <button
                type="button"
                aria-label={`Remove ${connection.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-red-400"
                onClick={() => void removeRemote(connection.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}

        {adding ? (
          <div className="space-y-2.5 py-3">
            <Input aria-label="Worker name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              aria-label="Worker URL"
              type="url"
              placeholder="https://host:47831"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Input
              aria-label="Worker password"
              type="password"
              placeholder="Token (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!url.trim()} onClick={() => void submit()}>
                Add Worker
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 py-3 text-left text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            onClick={() => setAdding(true)}
          >
            <Plus size={15} />
            Add remote worker
          </button>
        )}
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

const ThemeSwatch: React.FC<{ scheme: string; mode: "light" | "dark" }> = ({ scheme, mode }) => (
  <span
    data-scheme={scheme}
    data-mode={mode}
    className="relative flex h-14 w-14 overflow-hidden rounded-full bg-neutral-950 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.18),0_2px_6px_rgb(0_0_0_/_0.25)]"
  >
    <span
      className="absolute inset-0"
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--n-200)) 0%, rgb(var(--n-400)) 30%, rgb(var(--n-700)) 62%, rgb(var(--n-950)) 100%)"
      }}
    />
    <span className="absolute -left-3 -top-4 h-10 w-10 rounded-full bg-white/25 blur-md" />
    <span className="absolute bottom-1.5 right-2 h-2 w-2 rounded-full bg-white/35 blur-[1px]" />
  </span>
);

const ThemeChoice: React.FC<{
  label: string;
  scheme: string;
  mode: "light" | "dark";
  selected: boolean;
  onSelect: () => void;
}> = ({ label, scheme, mode, selected, onSelect }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className="group relative flex w-20 flex-col items-center gap-2 rounded-lg py-1.5 focus:outline-none focus-visible:bg-neutral-800/60"
  >
    <ThemeSwatch scheme={scheme} mode={mode} />
    <span
      className={cn(
        "absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-[11px] transition-colors",
        selected
          ? "border-neutral-100 bg-neutral-100 text-neutral-900"
          : "border-neutral-600 bg-neutral-900/70 text-transparent group-hover:border-neutral-400"
      )}
    >
      <Check size={12} strokeWidth={3} />
    </span>
    <span
      className={cn(
        "text-[11px] transition-colors",
        selected ? "text-neutral-100" : "text-neutral-400 group-hover:text-neutral-200"
      )}
    >
      {label}
    </span>
  </button>
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
      <section className="space-y-3">
        <SectionHeading title="Theme" description="Choose your visual tone" />
        <div className="flex flex-wrap gap-3">
          {COLOR_SCHEMES.map((scheme) => (
            <ThemeChoice
              key={scheme.id}
              label={scheme.label}
              scheme={scheme.id}
              mode={resolvedMode}
              selected={appConfig.theme === scheme.id}
              onSelect={() => void updateAppConfig({ theme: scheme.id })}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading title="Color Mode" description="System follows the OS · Dynamic follows the time of day" />
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
      </section>

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

const StorageSettings: React.FC = () => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";

  const [workspacesDir, setWorkspacesDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setWorkspacesDir(config.workspacesDir);
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
        workspacesDir
      });
      setMessage("Saved. Storage changes apply after a daemon restart.");
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
          Storage settings are read-only while connected to a remote worker. Change them from that
          worker’s local app.
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

      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}

      {isLocal && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save storage settings"}
        </Button>
      )}
    </div>
  );
};

const DaemonAccessSettings: React.FC<{
  api: ApiClient | null;
  editable: boolean;
  remote?: boolean;
  onGoToLocalAccess?: () => void;
}> = ({ api, editable, remote = false, onGoToLocalAccess }) => {
  const [httpEnabled, setHttpEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!api) {
      setMessage("Local worker is not available.");
      return;
    }
    let active = true;
    setMessage(null);
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setHttpEnabled(config.transports.http.enabled);
        setHost(config.transports.http.host);
        setPort(String(config.transports.http.port));
      })
      .catch(() => setMessage("Could not load access settings."));
    return () => {
      active = false;
    };
  }, [api]);

  const save = async () => {
    if (!api || !editable) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.updateDaemonConfig({
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
      setMessage("Saved. Access changes apply after a daemon restart.");
    } catch {
      setMessage("Failed to save access settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {remote && (
        <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
          <p>This worker’s access settings are read-only here. Change them from its local app.</p>
          {onGoToLocalAccess && (
            <Button size="sm" variant="outline" className="mt-3" onClick={onGoToLocalAccess}>
              Go to Local Access
            </Button>
          )}
        </div>
      )}

      <Group title="HTTP Access">
        <Field label="Enabled" hint="Allow other clients to reach this worker.">
          <Switch checked={httpEnabled} disabled={!editable} onChange={setHttpEnabled} />
        </Field>
        <Field label="Host">
          <Input className="w-40 sm:w-64" value={host} disabled={!editable} onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field label="Port">
          <Input className="w-40 sm:w-64" value={port} disabled={!editable} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field label="Password" hint="Min 8 chars. Leave blank to keep current.">
          <Input
            className="w-40 sm:w-64"
            type="password"
            placeholder="••••••••"
            value={password}
            disabled={!editable}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </Group>

      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}

      {editable && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save access settings"}
        </Button>
      )}
    </div>
  );
};

const LocalAccessSettings: React.FC = () => {
  const localApi = useAppStore((s) => s.localApi);
  return <DaemonAccessSettings api={localApi} editable />;
};

const AccessSettings: React.FC<{ onGoToLocalAccess?: () => void }> = ({ onGoToLocalAccess }) => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";
  return <DaemonAccessSettings api={api} editable={isLocal} remote={!isLocal} onGoToLocalAccess={onGoToLocalAccess} />;
};
