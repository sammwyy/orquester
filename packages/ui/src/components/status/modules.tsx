import React from "react";
import { Bot, Battery, BatteryCharging, Cpu, ExternalLink, FileDiff, GitBranch, GitBranchPlus, GitCommitHorizontal, HardDrive, ListTree, LockKeyhole, LockKeyholeOpen, MemoryStick, Music2, Network, Pause, Play, Plug, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { registerStatusModule } from "./registry";
import { countProcessNodes, ProcessTree } from "./ProcessTree";
import { useApi } from "../../context/orquester-context";
import { useAppStore, useAgentSessions, type AgentSession } from "../../store/app";
import { cn } from "../../lib/cn";

const GitLabel: React.FC = () => {
  const status = useAppStore((state) => state.gitStatus);
  return (
    <>
      <span>{status?.branch ?? "Git"}</span>
      {status && (status.additions > 0 || status.deletions > 0) && (
        <span>(+{status.additions} -{status.deletions})</span>
      )}
    </>
  );
};

const GitMobileLabel: React.FC = () => {
  const branch = useAppStore((state) => state.gitStatus?.branch);
  return <span className="max-w-20 truncate">{branch ?? "Git"}</span>;
};

const GitContent: React.FC = () => {
  const status = useAppStore((state) => state.gitStatus);
  const loading = useAppStore((state) => state.gitStatusLoading);
  const initializeGit = useAppStore((state) => state.initializeGit);
  const [tab, setTab] = React.useState<"origin" | "commits" | "files">("origin");
  if (!status) {
    return (
      <div className="min-w-64">
        <p className="text-xs font-medium">No Git repository</p>
        <p className="mt-1 text-[10px] text-current/60">Initialize this project to start tracking changes.</p>
        <button
          type="button"
          className="mt-3 flex items-center gap-1.5 rounded-md border border-current/15 px-2 py-1.5 text-[10px] text-current/80 hover:bg-current/10 hover:text-current disabled:opacity-50"
          disabled={loading}
          onClick={() => void initializeGit()}
        >
          <GitBranchPlus size={12} />
          {loading ? "Initializing…" : "Initialize repository"}
        </button>
      </div>
    );
  }
  return (
    <div className="min-w-64">
      <div className="mb-2 flex gap-1 border-b border-white/10 pb-1">
        {(["origin", "commits", "files"] as const).map((item) => (
          <button key={item} type="button" className="rounded px-1.5 py-1 text-[10px] capitalize text-current/70 hover:bg-white/10 hover:text-current" onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      {tab === "origin" && <p className="max-w-72 break-all text-[11px]">{status.origin ?? "No origin configured"}</p>}
      {tab === "commits" && <div className="space-y-1.5">{status.commits.map((commit) => <div key={commit.hash} className="flex gap-1.5 text-[10px]"><GitCommitHorizontal size={12} className="mt-0.5 shrink-0" /><span className="truncate">{commit.subject}</span></div>)}</div>}
      {tab === "files" && <div className="space-y-1.5">{status.files.length === 0 ? <p className="text-[10px] opacity-60">Working tree clean</p> : status.files.map((file) => <div key={`${file.status}-${file.path}`} className="flex gap-1.5 text-[10px]"><FileDiff size={12} className="mt-0.5 shrink-0" /><span className="truncate">{file.status} {file.path}</span></div>)}</div>}
    </div>
  );
};

const BatteryLabel: React.FC = () => {
  const status = useAppStore((state) => state.batteryStatus);
  if (!status) return <span>Battery…</span>;
  if (!status.hasBattery) {
    return (
      <span className="flex items-center gap-1 text-current/60">
        <Plug size={13} />
        <span>AC Power</span>
      </span>
    );
  }

  const percentage = status.percentage ?? 0;
  const tone = percentage <= 15 ? "text-red-400" : percentage <= 30 ? "text-orange-300" : "text-current";
  return (
    <span className={`flex items-center gap-1 ${tone}`}>
      {status.pluggedIn ? <BatteryCharging size={13} /> : <Battery size={13} />}
      <span>{percentage}%</span>
    </span>
  );
};

const BatteryMobileLabel: React.FC = () => {
  const status = useAppStore((state) => state.batteryStatus);
  if (!status) return <span>—</span>;
  return (
    <span className="flex items-center gap-1">
      {status.hasBattery ? (status.pluggedIn ? <BatteryCharging size={11} /> : <Battery size={11} />) : <Plug size={11} />}
      {status.hasBattery ? `${status.percentage ?? 0}%` : "AC"}
    </span>
  );
};

const BatteryContent: React.FC = () => {
  const battery = useAppStore((state) => state.batteryStatus);
  const keepAwake = useAppStore((state) => state.integrations.find((integration) => integration.id === "keep-awake"));
  const updateIntegration = useAppStore((state) => state.updateIntegration);
  if (!battery) return <p className="text-xs text-neutral-500">Battery information unavailable.</p>;
  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      <div className="flex items-center justify-between border-b border-neutral-700/50 pb-2.5">
        <div>
          <p className="text-xs font-medium text-neutral-100">{battery.hasBattery ? "Battery" : "AC Power"}</p>
          <p className="mt-0.5 text-[10px] text-neutral-500">
            {battery.hasBattery ? (battery.pluggedIn ? "Connected to power" : "Running on battery") : "No battery installed"}
          </p>
        </div>
        {battery.hasBattery
          ? <span className="text-sm tabular-nums text-neutral-300">{battery.percentage ?? 0}%</span>
          : <Plug size={16} className="text-neutral-400" />}
      </div>
      {keepAwake && (
        <button
          type="button"
          disabled={!keepAwake.available}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left hover:bg-white/5 disabled:opacity-40"
          onClick={() => void updateIntegration("keep-awake", !keepAwake.enabled)}
        >
          {keepAwake.enabled ? <LockKeyhole size={14} className="text-amber-300" /> : <LockKeyholeOpen size={14} className="text-neutral-500" />}
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-neutral-200">Keep Awake</span>
            <span className="block text-[10px] text-neutral-500">{keepAwake.enabled ? "Idle sleep is prevented" : "Allow normal idle sleep"}</span>
          </span>
          <span className={`h-2 w-2 rounded-full ${keepAwake.enabled ? "bg-amber-300" : "bg-neutral-600"}`} />
        </button>
      )}
    </div>
  );
};

const formatBytes = (bytes: number): string => {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const maximumFractionDigits = unit === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)} ${units[unit]}`;
};

const formatPercentage = (value: number): string => `${Math.round(Number.isFinite(value) ? value : 0)}%`;

const ResourcesLabel: React.FC = () => {
  const resources = useAppStore((state) => state.systemResources);
  if (!resources) return <span>Resources…</span>;
  return (
    <span className="flex items-center gap-2 text-current/80">
      <span className="flex items-center gap-0.5"><Cpu size={11} />{formatPercentage(resources.cpu.percentage)}</span>
      <span className="flex items-center gap-0.5"><MemoryStick size={11} />{formatPercentage(resources.memory.percentage)}</span>
      <span className="flex items-center gap-0.5"><HardDrive size={11} />{formatPercentage(resources.disk.percentage)}</span>
    </span>
  );
};

const ResourcesMobileLabel: React.FC = () => {
  const resources = useAppStore((state) => state.systemResources);
  if (!resources) return <span>—</span>;
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <Cpu size={11} />
      {formatPercentage(resources.cpu.percentage)} · {formatPercentage(resources.memory.percentage)} · {formatPercentage(resources.disk.percentage)}
    </span>
  );
};

const NetworkingLabel: React.FC = () => {
  const networking = useAppStore((state) => state.networkingStatus);
  const count = networking?.ports.length ?? 0;
  return <span className="flex items-center gap-1"><Network size={11} />{count} {count === 1 ? "port" : "ports"}</span>;
};

const NetworkingContent: React.FC = () => {
  const networking = useAppStore((state) => state.networkingStatus);
  const connections = useAppStore((state) => state.connections);
  const activeConnectionId = useAppStore((state) => state.activeConnectionId);
  const activateTab = useAppStore((state) => state.activateTab);
  const killProcess = useAppStore((state) => state.killNetworkingProcess);
  const [busyPid, setBusyPid] = React.useState<number | null>(null);
  const openExternal = (target: string) => {
    const desktop = (window as Window & { orquesterDesktop?: { openExternal?: (url: string) => Promise<boolean> } }).orquesterDesktop;
    if (desktop?.openExternal) void desktop.openExternal(target);
    else window.open(target, "_blank", "noopener,noreferrer");
  };
  const host = connections.find((connection) => connection.id === activeConnectionId)?.kind === "remote"
    ? (() => { try { return new URL(connections.find((connection) => connection.id === activeConnectionId)?.endpoint ?? "").hostname; } catch { return "localhost"; } })()
    : "localhost";
  if (!networking || networking.ports.length === 0) return <p className="text-xs text-neutral-500">No listening ports from Orquester processes.</p>;
  return (
    <div className="w-80 max-w-[calc(100vw-2rem)]">
      <div className="mb-2 border-b border-neutral-700/50 pb-2">
        <p className="text-xs font-medium text-neutral-100">Listening ports</p>
        <p className="mt-0.5 text-[10px] text-neutral-500">Processes owned by this worker</p>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {networking.ports.map((port) => {
          const url = `http://${host}:${port.port}`;
          return (
            <div key={`${port.pid}-${port.port}`} className="flex items-center gap-2 rounded-md px-1.5 py-2 hover:bg-white/5">
              <Network size={13} className="shrink-0 text-neutral-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] text-neutral-200">{port.process}</p>
                <p className="text-[10px] text-neutral-500">{port.address}:{port.port} · PID {port.pid}</p>
              </div>
              {port.sessionId && <button type="button" title="Focus session" className="text-neutral-500 hover:text-neutral-200" onClick={() => activateTab(port.sessionId!)}><Network size={13} /></button>}
              <button type="button" title="Open in browser" className="text-neutral-500 hover:text-neutral-200" onClick={() => openExternal(url)}><ExternalLink size={13} /></button>
              <button type="button" title="Stop process" disabled={busyPid === port.pid} className="text-neutral-500 hover:text-red-300 disabled:opacity-40" onClick={() => {
                if (!window.confirm(`Stop ${port.process} (PID ${port.pid})?`)) return;
                setBusyPid(port.pid);
                void killProcess(port.pid).finally(() => setBusyPid(null));
              }}><X size={13} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ProcessManagerLabel: React.FC = () => {
  const status = useAppStore((state) => state.processManagerStatus);
  const count = status ? countProcessNodes(status.roots) : 0;
  return <span className="flex items-center gap-1"><ListTree size={11} />{count} {count === 1 ? "process" : "processes"}</span>;
};

const ProcessManagerContent: React.FC = () => {
  const status = useAppStore((state) => state.processManagerStatus);
  const killProcess = useAppStore((state) => state.killProcess);
  const activateTab = useAppStore((state) => state.activateTab);
  if (!status) return <p className="text-xs text-neutral-500">Process information unavailable.</p>;
  return <ProcessTree roots={status.roots} onKill={killProcess} onFocusSession={activateTab} />;
};

/** Agent count and dot color per bucket in the Attention Center. */
const AGENT_TONES = { attention: "bg-amber-400", active: "bg-emerald-400", idle: "bg-neutral-600" } as const;

function bucketOf({ session }: AgentSession): keyof typeof AGENT_TONES {
  if (session.needsAttention) return "attention";
  if (session.active) return "active";
  return "idle";
}

const AgentsLabel: React.FC = () => {
  const sessions = useAgentSessions();
  const seen = useAppStore((state) => state.agentsBadgeSeen);
  if (sessions.length === 0) return null;

  const activeCount = sessions.filter((s) => bucketOf(s) === "active").length;
  const attentionCount = sessions.filter((s) => bucketOf(s) === "attention").length;
  const parts = [attentionCount > 0 ? `${attentionCount} fn` : null, activeCount > 0 ? `${activeCount} ac` : null].filter(Boolean);
  const suffix = !seen && parts.length > 0 ? ` (${parts.join(", ")})` : "";

  return (
    <span className="flex items-center gap-1">
      <Bot size={11} className={attentionCount > 0 && !seen ? "text-amber-400" : undefined} />
      {sessions.length} {sessions.length === 1 ? "Agent" : "Agents"}
      {suffix}
    </span>
  );
};

const AgentRow: React.FC<{ entry: AgentSession; onSelect: () => void }> = ({ entry, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-neutral-300 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
  >
    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", AGENT_TONES[bucketOf(entry)])} />
    <span className="min-w-0 flex-1 truncate">{entry.session.title}</span>
    <span className="shrink-0 truncate text-[10px] text-neutral-500">
      {entry.project.workspace ? `${entry.project.workspace}/` : ""}
      {entry.project.name}
    </span>
  </button>
);

const AgentGroup: React.FC<{ title: string; items: AgentSession[]; onSelect: (entry: AgentSession) => void }> = ({ title, items, onSelect }) => {
  if (items.length === 0) return null;
  return (
    <div className="mb-2 last:mb-0">
      <p className="px-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-neutral-600">{title}</p>
      <div className="space-y-0.5">
        {items.map((entry) => <AgentRow key={entry.session.id} entry={entry} onSelect={() => onSelect(entry)} />)}
      </div>
    </div>
  );
};

const AgentsContent: React.FC = () => {
  const sessions = useAgentSessions();
  const openProject = useAppStore((state) => state.openProject);
  const activateTab = useAppStore((state) => state.activateTab);
  const dismissAgentsBadge = useAppStore((state) => state.dismissAgentsBadge);

  // Opening the panel is "I've seen the summary" — clearing needsAttention on
  // individual sessions still only happens when their own tab is focused.
  React.useEffect(() => {
    dismissAgentsBadge();
  }, [dismissAgentsBadge]);

  if (sessions.length === 0) {
    return <p className="text-xs text-neutral-500">No agents open.</p>;
  }

  const buckets: Record<keyof typeof AGENT_TONES, AgentSession[]> = { attention: [], active: [], idle: [] };
  for (const entry of sessions) buckets[bucketOf(entry)].push(entry);
  // Most recently flagged first, same ordering Ctrl+Shift+A jumps through.
  buckets.attention.sort((a, b) =>
    (b.session.needsAttentionAt ?? b.session.createdAt).localeCompare(a.session.needsAttentionAt ?? a.session.createdAt)
  );

  const select = (entry: AgentSession) => {
    openProject(entry.project);
    activateTab(entry.session.id);
  };

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)]">
      <AgentGroup title="Needs Attention" items={buckets.attention} onSelect={select} />
      <AgentGroup title="Active" items={buckets.active} onSelect={select} />
      <AgentGroup title="Idle" items={buckets.idle} onSelect={select} />
    </div>
  );
};

type ResourceBarUsage = { percentage: number; usedBytes?: number; freeBytes?: number; totalBytes?: number };

const ResourceCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  detail: string;
  usage: ResourceBarUsage;
}> = ({ icon, label, detail, usage }) => (
  <div className="border-b border-neutral-700/50 py-2.5 last:border-b-0">
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-400">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] text-neutral-200">{label}</p>
          <p className="text-[11px] tabular-nums text-neutral-300">{formatPercentage(usage.percentage)}</p>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-neutral-500">{detail}</p>
      </div>
    </div>
    <div className="ml-8 mt-2 h-1 overflow-hidden rounded-full bg-neutral-700/70">
      <div className="h-full rounded-full bg-neutral-300/70" style={{ width: `${usage.percentage}%` }} />
    </div>
    {usage.usedBytes !== undefined && usage.freeBytes !== undefined && usage.totalBytes !== undefined && (
      <div className="ml-8 mt-1.5 flex justify-between gap-2 text-[10px] text-neutral-500">
        <span>{formatBytes(usage.usedBytes)} used</span>
        <span>{formatBytes(usage.freeBytes)} free · {formatBytes(usage.totalBytes)} total</span>
      </div>
    )}
  </div>
);

const ResourcesContent: React.FC = () => {
  const resources = useAppStore((state) => state.systemResources);
  if (!resources) return <p className="text-xs text-current/60">System resources unavailable.</p>;
  return (
    <div className="w-72 max-w-[calc(100vw-2rem)]">
      <div className="mb-1 flex items-center justify-between px-0.5 pb-1.5">
        <p className="text-xs font-medium text-neutral-100">System Resources</p>
        <span className="text-[10px] text-neutral-500">This worker</span>
      </div>
      <ResourceCard
        icon={<Cpu size={16} />}
        label="CPU"
        detail={`${resources.cpu.cores} logical cores`}
        usage={{ percentage: resources.cpu.percentage }}
      />
      <ResourceCard
        icon={<MemoryStick size={16} />}
        label="Memory"
        detail="System memory"
        usage={resources.memory}
      />
      <ResourceCard
        icon={<HardDrive size={16} />}
        label="Storage"
        detail={resources.disk.mount}
        usage={resources.disk}
      />
    </div>
  );
};

const MediaLabel: React.FC = () => {
  const media = useAppStore((state) => state.mediaStatus);
  if (!media?.available) return <span>Media</span>;
  const title = media.title || "No media";
  const text = media.artist ? `${media.artist} — ${title}` : title;
  const stateIcon = media.state === "playing" ? <Play size={10} /> : <Pause size={10} />;
  return (
    <span className="flex min-w-0 max-w-36 items-center gap-1 text-neutral-300" title={text}>
      {media.state === "stopped" ? <Music2 size={11} className="shrink-0 text-neutral-500" /> : stateIcon}
      <span className="min-w-0 overflow-hidden whitespace-nowrap">
        <span className={text.length > 24 ? "inline-block animate-status-marquee" : "inline-block truncate"}>{text}</span>
      </span>
    </span>
  );
};

const MediaMobileLabel: React.FC = () => {
  const media = useAppStore((state) => state.mediaStatus);
  return (
    <span className="flex max-w-16 items-center gap-1 truncate">
      <Music2 size={11} className="shrink-0" />
      <span className="truncate">{media?.available ? media.title || "Media" : "Media"}</span>
    </span>
  );
};

const MediaContent: React.FC = () => {
  const api = useApi();
  const media = useAppStore((state) => state.mediaStatus);
  const controlMedia = useAppStore((state) => state.controlMedia);
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);
  const [volume, setVolume] = React.useState(media?.volume ?? 0);
  const volumeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    setVolume(media?.volume ?? 0);
  }, [media?.volume]);
  React.useEffect(() => () => {
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
  }, []);
  React.useEffect(() => {
    let active = true;
    setThumbnail(null);
    if (media?.available && media.title) {
      void api.mediaThumbnail().then((url) => {
        if (active) setThumbnail(url);
        else if (url) URL.revokeObjectURL(url);
      });
    }
    return () => {
      active = false;
      setThumbnail((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
    };
  }, [api, media?.thumbnailKey, media?.title, media?.artist, media?.album]);
  if (!media?.available) return <p className="text-xs text-neutral-500">Media controls unavailable.</p>;
  const title = media.title || "Nothing playing";
  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      <div className="mb-3 flex items-start gap-2 border-b border-neutral-700/50 pb-2.5">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="mt-0.5 h-10 w-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="mt-0.5 text-neutral-400"><Music2 size={15} /></span>
        )}
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-100">{title}</p>
          <p className="mt-0.5 truncate text-[10px] text-neutral-500">{media.artist || media.player || "No active player"}</p>
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        <button type="button" aria-label="Previous" className="text-neutral-400 hover:text-neutral-100" onClick={() => void controlMedia({ action: "previous" })}>
          <SkipBack size={15} />
        </button>
        <button type="button" aria-label={media.state === "playing" ? "Pause" : "Play"} className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-neutral-900 hover:bg-white" onClick={() => void controlMedia({ action: "playPause" })}>
          {media.state === "playing" ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" aria-label="Next" className="text-neutral-400 hover:text-neutral-100" onClick={() => void controlMedia({ action: "next" })}>
          <SkipForward size={15} />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-neutral-700/50 pt-2.5">
        <Volume2 size={13} className="shrink-0 text-neutral-500" />
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          className="h-1 min-w-0 flex-1 accent-neutral-300"
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            if (volumeTimer.current) clearTimeout(volumeTimer.current);
            volumeTimer.current = setTimeout(() => {
              void controlMedia({ action: "volume", volume: nextVolume });
            }, 120);
          }}
        />
        <span className="w-7 text-right text-[10px] tabular-nums text-neutral-500">{media.volumeAvailable ? `${Math.round(volume * 100)}%` : "—"}</span>
      </div>
    </div>
  );
};

registerStatusModule({
  id: "project.git",
  label: <GitLabel />,
  mobileLabel: <GitMobileLabel />,
  side: "left",
  integration: "git",
  icon: <GitBranch size={12} />,
  enabledOn: ["project"],
  content: GitContent
});

registerStatusModule({
  id: "system.battery",
  label: <BatteryLabel />,
  mobileLabel: <BatteryMobileLabel />,
  side: "right",
  integration: "battery",
  content: BatteryContent
});

registerStatusModule({
  id: "system.resources",
  label: <ResourcesLabel />,
  mobileLabel: <ResourcesMobileLabel />,
  side: "right",
  integration: "system-resources",
  content: ResourcesContent
});

registerStatusModule({
  id: "system.networking",
  label: <NetworkingLabel />,
  mobileLabel: <NetworkingLabel />,
  side: "left",
  integration: "networking",
  content: NetworkingContent
});

registerStatusModule({
  id: "system.processManager",
  label: <ProcessManagerLabel />,
  mobileLabel: <ProcessManagerLabel />,
  side: "left",
  integration: "process-manager",
  content: ProcessManagerContent
});

// No `integration`: the Attention Center reads sessions the client already
// has, so it isn't gated behind worker availability like the others.
registerStatusModule({
  id: "system.agents",
  label: <AgentsLabel />,
  mobileLabel: <AgentsLabel />,
  side: "left",
  content: AgentsContent
});

registerStatusModule({
  id: "system.media",
  label: <MediaLabel />,
  mobileLabel: <MediaMobileLabel />,
  side: "right",
  integration: "media",
  content: MediaContent
});
