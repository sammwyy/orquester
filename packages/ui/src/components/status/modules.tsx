import React from "react";
import { Battery, BatteryCharging, Cpu, FileDiff, GitBranch, GitBranchPlus, GitCommitHorizontal, HardDrive, MemoryStick } from "lucide-react";
import { registerStatusModule } from "./registry";
import { useAppStore } from "../../store/app";

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
  if (!status.hasBattery) return <span className="text-current/60">No battery</span>;

  const percentage = status.percentage ?? 0;
  const tone = percentage <= 15 ? "text-red-400" : percentage <= 30 ? "text-orange-300" : "text-current";
  return (
    <span className={`flex items-center gap-1 ${tone}`}>
      {status.pluggedIn ? <BatteryCharging size={13} /> : <Battery size={13} />}
      <span>{percentage}%</span>
    </span>
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

const ResourcesLabel: React.FC = () => {
  const resources = useAppStore((state) => state.systemResources);
  if (!resources) return <span>Resources…</span>;
  return (
    <span className="flex items-center gap-2 text-current/80">
      <span className="flex items-center gap-0.5"><Cpu size={11} />{resources.cpu.percentage}%</span>
      <span className="flex items-center gap-0.5"><MemoryStick size={11} />{resources.memory.percentage}%</span>
      <span className="flex items-center gap-0.5"><HardDrive size={11} />{resources.disk.percentage}%</span>
    </span>
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
          <p className="text-[11px] tabular-nums text-neutral-300">{usage.percentage}%</p>
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

registerStatusModule({
  id: "project.git",
  label: <GitLabel />,
  side: "left",
  integration: "git",
  icon: <GitBranch size={12} />,
  enabledOn: ["project"],
  content: GitContent
});

registerStatusModule({
  id: "system.battery",
  label: <BatteryLabel />,
  side: "right",
  integration: "battery"
});

registerStatusModule({
  id: "system.resources",
  label: <ResourcesLabel />,
  side: "right",
  integration: "system-resources",
  content: ResourcesContent
});
