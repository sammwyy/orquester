import React from "react";
import type { ProcessNode } from "@orquester/api";
import { ChevronDown, ChevronRight, Cpu, Terminal, X } from "lucide-react";

const formatMemory = (bytes: number): string => {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatCpu = (percentage: number): string => `${percentage < 10 ? percentage.toFixed(1) : Math.round(percentage)}%`;

interface ProcessTreeRowProps {
  node: ProcessNode;
  depth: number;
  protectedPid: number;
  collapsed: Set<number>;
  onToggle: (pid: number) => void;
  busyPid: number | null;
  onKill: (node: ProcessNode) => void;
  onFocusSession?: (sessionId: string) => void;
}

const ProcessTreeRow: React.FC<ProcessTreeRowProps> = ({ node, depth, protectedPid, collapsed, onToggle, busyPid, onKill, onFocusSession }) => {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.pid);
  const isProtected = node.pid === protectedPid;
  return (
    <div>
      <div className="group flex items-center gap-1.5 rounded-md py-1 pr-1.5 hover:bg-white/5" style={{ paddingLeft: 6 + depth * 16 }}>
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center text-neutral-600 hover:text-neutral-300 disabled:opacity-0"
          disabled={!hasChildren}
          onClick={() => onToggle(node.pid)}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {hasChildren && (isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11px] text-neutral-200" title={node.command}>{node.name}</p>
            {node.isSessionRoot && (
              <button
                type="button"
                title="Focus session"
                className="shrink-0 text-emerald-500/80 hover:text-emerald-300"
                onClick={() => node.sessionId && onFocusSession?.(node.sessionId)}
              >
                <Terminal size={11} />
              </button>
            )}
          </div>
          <p className="text-[10px] text-neutral-500">PID {node.pid} · {formatCpu(node.cpuPercentage)} CPU · {formatMemory(node.memoryBytes)}</p>
        </div>
        {!isProtected && (
          <button
            type="button"
            title="Stop process"
            disabled={busyPid === node.pid}
            className="shrink-0 text-neutral-600 opacity-0 hover:text-red-300 disabled:opacity-40 group-hover:opacity-100"
            onClick={() => onKill(node)}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <ProcessTreeRow
              key={child.pid}
              node={child}
              depth={depth + 1}
              protectedPid={protectedPid}
              collapsed={collapsed}
              onToggle={onToggle}
              busyPid={busyPid}
              onKill={onKill}
              onFocusSession={onFocusSession}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const countProcessNodes = (nodes: ProcessNode[]): number => nodes.reduce((total, node) => total + 1 + countProcessNodes(node.children), 0);

export interface ProcessTreeProps {
  roots: ProcessNode[];
  onKill: (pid: number) => Promise<void>;
  onFocusSession?: (sessionId: string) => void;
}

export const ProcessTree: React.FC<ProcessTreeProps> = ({ roots, onKill, onFocusSession }) => {
  const [collapsed, setCollapsed] = React.useState<Set<number>>(() => new Set());
  const [busyPid, setBusyPid] = React.useState<number | null>(null);

  const toggle = (pid: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  const handleKill = (node: ProcessNode) => {
    const label = node.children.length > 0 ? `${node.name} and its child processes` : node.name;
    if (!window.confirm(`Stop ${label} (PID ${node.pid})?`)) return;
    setBusyPid(node.pid);
    void onKill(node.pid).finally(() => setBusyPid(null));
  };

  if (roots.length === 0) {
    return <p className="text-xs text-neutral-500">No process information available.</p>;
  }

  return (
    <div className="w-96 max-w-[calc(100vw-2rem)]">
      <div className="mb-2 flex items-center justify-between border-b border-neutral-700/50 pb-2">
        <div>
          <p className="text-xs font-medium text-neutral-100">Process Manager</p>
          <p className="mt-0.5 text-[10px] text-neutral-500">Processes owned by this worker</p>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-neutral-500"><Cpu size={11} />{countProcessNodes(roots)}</span>
      </div>
      <div className="max-h-80 space-y-0.5 overflow-y-auto">
        {roots.map((root) => (
          <ProcessTreeRow
            key={root.pid}
            node={root}
            depth={0}
            protectedPid={root.pid}
            collapsed={collapsed}
            onToggle={toggle}
            busyPid={busyPid}
            onKill={handleKill}
            onFocusSession={onFocusSession}
          />
        ))}
      </div>
    </div>
  );
};
