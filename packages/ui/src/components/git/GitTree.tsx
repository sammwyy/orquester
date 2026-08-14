import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  CloudDownload,
  CornerUpLeft,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2
} from "lucide-react";
import type { GitBranchSummary, GitCommitSummary, GitStashSummary, GitStatusResponse } from "@orquester/api";
import { cn } from "../../lib/cn";
import { useApi } from "../../context/orquester-context";
import { ApiError } from "../../lib/api-client";
import { Dropdown, DropdownItem, Input } from "../ui";
import { Avatar } from "./Avatar";
import { CommitDetail } from "./CommitDetail";
import { WorkingChanges } from "./WorkingChanges";
import { layoutGraph, laneColor, type GraphRow } from "./graph";
import { useAppStore } from "../../store/app";

type SidebarTab = "branches" | "stash";

const LOG_PAGE_SIZE = 150;
const ROW_H = 40;
const LANE_W = 18;
const DOT_R = 4.5;

interface RefBadge {
  text: string;
  kind: "head" | "branch" | "remote" | "tag";
}

/** `%D` decorations parsed into displayable badges; a remote's bare "origin/HEAD" pointer is dropped as noise. */
function parseRefBadges(refs: string[]): RefBadge[] {
  const badges: RefBadge[] = [];
  for (const raw of refs) {
    if (/^[^/]+\/HEAD$/.test(raw)) continue;
    if (raw.startsWith("HEAD -> ")) {
      badges.push({ text: raw.slice(8), kind: "head" });
    } else if (raw === "HEAD") {
      badges.push({ text: "HEAD", kind: "head" });
    } else if (raw.startsWith("tag: ")) {
      badges.push({ text: raw.slice(5), kind: "tag" });
    } else if (raw.includes("/")) {
      badges.push({ text: raw, kind: "remote" });
    } else {
      badges.push({ text: raw, kind: "branch" });
    }
  }
  return badges;
}

const RefPill: React.FC<{ badge: RefBadge }> = ({ badge }) => (
  <span
    className={cn(
      "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
      badge.kind === "head" && "bg-neutral-100 text-neutral-900 shadow-sm shadow-black/20",
      badge.kind === "branch" && "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
      badge.kind === "remote" && "bg-neutral-800 text-neutral-400",
      badge.kind === "tag" && "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/20"
    )}
  >
    {badge.kind === "tag" && <Tag size={9} />}
    {badge.text}
  </span>
);

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"]
  ];
  let value = seconds / 60;
  for (const [span, unit] of units) {
    if (value < span) return `${Math.floor(value)}${unit}`;
    value /= span;
  }
  return "";
};

/** One row's local graph SVG: passthrough lanes, the commit's in/out edges, and its dot. */
const GraphCell: React.FC<{ row: GraphRow; maxLanes: number; isHead: boolean }> = ({ row, maxLanes, isHead }) => {
  const width = Math.max(1, maxLanes) * LANE_W;
  const cx = (col: number) => col * LANE_W + LANE_W / 2;
  const cy = ROW_H / 2;
  const verticalRange = (half: "top" | "bottom" | "full"): [number, number] =>
    half === "top" ? [0, cy] : half === "bottom" ? [cy, ROW_H] : [0, ROW_H];
  const filterId = useId();

  return (
    <svg width={width} height={ROW_H} className="shrink-0 overflow-visible">
      {isHead && (
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      {row.segments.map((segment, index) => {
        if (segment.kind === "line") {
          const [y1, y2] = verticalRange(segment.half);
          const x = cx(segment.col);
          return (
            <line
              key={index}
              x1={x}
              y1={y1}
              x2={x}
              y2={y2}
              stroke={laneColor(segment.colorIndex)}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        }
        if (segment.kind === "curve") {
          const x1 = cx(segment.fromCol);
          const x2 = cx(segment.toCol);
          const path = `M ${x1} ${cy} C ${x1} ${cy + (ROW_H - cy) * 0.65}, ${x2} ${ROW_H - (ROW_H - cy) * 0.65}, ${x2} ${ROW_H}`;
          return (
            <path
              key={index}
              d={path}
              fill="none"
              stroke={laneColor(segment.colorIndex)}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        }
        const x = cx(segment.col);
        return (
          <circle
            key={index}
            cx={x}
            cy={cy}
            r={segment.isMerge ? DOT_R + 1.5 : DOT_R}
            fill={isHead ? "#fafafa" : laneColor(segment.colorIndex)}
            stroke={isHead ? laneColor(segment.colorIndex) : "rgba(0,0,0,0.35)"}
            strokeWidth={isHead ? 2.5 : 1}
            filter={isHead ? `url(#${filterId})` : undefined}
          />
        );
      })}
    </svg>
  );
};

/** A single dot with no lane lines — used when filtering breaks the graph's parent-child adjacency. */
const FlatDot: React.FC<{ isHead: boolean }> = ({ isHead }) => (
  <svg width={LANE_W} height={ROW_H} className="shrink-0">
    <circle
      cx={LANE_W / 2}
      cy={ROW_H / 2}
      r={DOT_R}
      fill={isHead ? "#f5f5f5" : "#737373"}
      stroke={isHead ? "#a3a3a3" : "rgba(0,0,0,0.35)"}
      strokeWidth={isHead ? 2.5 : 1}
    />
  </svg>
);

const CommitRow: React.FC<{
  row: GraphRow;
  /** null in filtered/flat mode: the underlying graph segments span columns a narrowed view can't show. */
  showGraph: boolean;
  maxLanes: number;
  active: boolean;
  compact: boolean;
  onSelect: () => void;
}> = ({ row, showGraph, maxLanes, active, compact, onSelect }) => {
  const badges = parseRefBadges(row.commit.refs);
  const isHead = row.commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "));
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center rounded-lg px-2 text-left transition-colors",
        compact ? "gap-2" : "gap-3",
        active ? "bg-neutral-800" : "hover:bg-neutral-900/70"
      )}
      style={{ height: ROW_H }}
    >
      {showGraph ? <GraphCell row={row} maxLanes={maxLanes} isHead={isHead} /> : <FlatDot isHead={isHead} />}
      {!compact && <Avatar name={row.commit.author} size={22} className="ring-1 ring-inset ring-black/20" />}
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", active ? "font-medium text-neutral-100" : "text-neutral-300")}>
        {row.commit.subject}
      </span>
      {badges.length > 0 && !compact && (
        <span className="flex max-w-[35%] shrink items-center gap-1 overflow-hidden">
          {badges.map((badge, index) => (
            <RefPill key={index} badge={badge} />
          ))}
        </span>
      )}
      {!compact && <span className="hidden w-8 shrink-0 text-right font-mono text-[10px] text-neutral-600 xl:block">{formatRelative(row.commit.date)}</span>}
      {!compact && <span className="hidden w-12 shrink-0 text-right font-mono text-[10px] text-neutral-600 2xl:block">{row.commit.hash.slice(0, 7)}</span>}
    </button>
  );
};

const BranchRow: React.FC<{
  branch: GitBranchSummary;
  label?: string;
  selected: boolean;
  checkingOut: boolean;
  pulling: boolean;
  onSelect: () => void;
  onCheckout: () => void;
  onPull: () => void;
}> = ({ branch, label, selected, checkingOut, pulling, onSelect, onCheckout, onPull }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect()}
    className={cn(
      "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
      selected
        ? "bg-neutral-800 text-neutral-100"
        : branch.current
          ? "bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15"
          : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
    )}
  >
    <GitBranch size={13} className={cn("shrink-0", branch.current ? "text-emerald-400" : "text-neutral-600")} />
    <span className="min-w-0 flex-1 truncate" title={branch.name}>{label ?? branch.name}</span>
    {branch.current && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-500">current</span>}
    {branch.ahead > 0 && (
      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-500">
        <ArrowUp size={10} />
        {branch.ahead}
      </span>
    )}
    {branch.behind > 0 && (
      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-amber-500">
        <ArrowDown size={10} />
        {branch.behind}
      </span>
    )}
    {branch.current && branch.behind > 0 && (
      <button
        type="button"
        title={`Pull ${branch.behind} commit${branch.behind === 1 ? "" : "s"} from ${branch.upstream ?? "upstream"}`}
        onClick={(event) => {
          event.stopPropagation();
          onPull();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-emerald-400 opacity-0 transition-opacity hover:bg-emerald-500/20 group-hover:opacity-100"
      >
        {pulling ? <LoaderCircle size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
      </button>
    )}
    {!branch.current && !branch.remote && (
      <button
        type="button"
        title={`Check out ${branch.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onCheckout();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
      >
        {checkingOut ? <LoaderCircle size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />}
      </button>
    )}
  </div>
);

const formatStashDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const StashRow: React.FC<{
  stash: GitStashSummary;
  active: boolean;
  busy: boolean;
  onSelect: () => void;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
}> = ({ stash, active, busy, onSelect, onApply, onPop, onDrop }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect()}
    className={cn(
      "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors",
      active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
    )}
  >
    <Archive size={13} className="shrink-0 text-neutral-600" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-[12px]">{stash.message}</p>
      <p className="truncate text-[10px] text-neutral-600">
        {stash.branch && `${stash.branch} · `}
        {formatStashDate(stash.date)}
      </p>
    </div>
    {busy ? (
      <LoaderCircle size={13} className="shrink-0 animate-spin text-neutral-500" />
    ) : (
      <span onClick={(event) => event.stopPropagation()} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        <Dropdown
          align="right"
          width="w-48"
          trigger={
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100">
              <MoreHorizontal size={13} />
            </span>
          }
        >
          <DropdownItem icon={<CornerUpLeft size={13} />} onClick={onApply}>
            Apply
          </DropdownItem>
          <DropdownItem icon={<Archive size={13} />} onClick={onPop}>
            Pop (apply + drop)
          </DropdownItem>
          <DropdownItem icon={<Trash2 size={13} />} onClick={onDrop}>
            Drop
          </DropdownItem>
        </Dropdown>
      </span>
    )}
  </div>
);

export const GitTree: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const api = useApi();
  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>(undefined);
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [notARepo, setNotARepo] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("branches");
  const [stashes, setStashes] = useState<GitStashSummary[]>([]);
  const [stashesLoading, setStashesLoading] = useState(false);
  const [stashBusy, setStashBusy] = useState<string | null>(null);
  const [creatingStash, setCreatingStash] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<GitStatusResponse | null>(null);
  const [showWorking, setShowWorking] = useState(false);
  const panelKey = `${rootPath}:git`;
  const setPanelSize = useAppStore((s) => s.setPanelSize);
  const [sidebarWidth, setSidebarWidth] = useState(() => useAppStore.getState().clientUiState.panelSizes[panelKey] ?? 248);
  const resizingSidebar = useRef(false);
  const [collapsedRemotes, setCollapsedRemotes] = useState<Set<string>>(new Set());

  const loadWorkingStatus = useCallback(async () => {
    try {
      setWorkingStatus(await api.gitStatus(rootPath));
    } catch {
      setWorkingStatus(null);
    }
  }, [api, rootPath]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await api.gitBranches(rootPath);
      setBranches(res.branches);
      setNotARepo(false);
    } catch {
      setNotARepo(true);
    } finally {
      setBranchesLoading(false);
    }
  }, [api, rootPath]);

  const loadLog = useCallback(
    async (branch: string | undefined, skip: number) => {
      if (skip === 0) setLogLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const res = await api.gitLog(rootPath, { branch, limit: LOG_PAGE_SIZE, skip });
        setCommits((prev) => (skip === 0 ? res.commits : [...prev, ...res.commits]));
        setHasMore(res.hasMore);
      } catch {
        setError("Could not load commit history.");
      } finally {
        setLogLoading(false);
        setLoadingMore(false);
      }
    },
    [api, rootPath]
  );

  const loadStashes = useCallback(async () => {
    setStashesLoading(true);
    try {
      const res = await api.gitStashes(rootPath);
      setStashes(res.stashes);
    } catch {
      setError("Could not load stashes.");
    } finally {
      setStashesLoading(false);
    }
  }, [api, rootPath]);

  useEffect(() => {
    setBranchesLoading(true);
    void loadBranches();
    void loadWorkingStatus();
  }, [loadBranches, loadWorkingStatus]);

  useEffect(() => {
    void loadLog(selectedBranch, 0);
    setSelectedHash(null);
  }, [loadLog, selectedBranch]);

  useEffect(() => {
    if (sidebarTab === "stash") void loadStashes();
  }, [sidebarTab, loadStashes]);

  const refresh = () => {
    void loadBranches();
    void loadLog(selectedBranch, 0);
    void loadWorkingStatus();
    if (sidebarTab === "stash") void loadStashes();
  };

  const checkout = async (ref: string) => {
    setCheckingOut(ref);
    setError(null);
    try {
      await api.gitCheckout({ path: rootPath, ref });
      await loadBranches();
      await loadLog(selectedBranch, 0);
      await loadWorkingStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check out that branch.");
    } finally {
      setCheckingOut(null);
    }
  };

  const fetchRemote = async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await api.fetchGitRemote(rootPath);
      setBranches(res.branches);
      await loadLog(selectedBranch, 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not fetch.");
    } finally {
      setFetching(false);
    }
  };

  const pull = async () => {
    setPulling(true);
    setError(null);
    try {
      await api.pullGitBranch(rootPath);
      await loadBranches();
      await loadLog(selectedBranch, 0);
      await loadWorkingStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not pull — resolve the conflict from a terminal.");
    } finally {
      setPulling(false);
    }
  };

  const runStashAction = async (ref: string, action: "apply" | "pop" | "drop") => {
    setStashBusy(ref);
    setError(null);
    try {
      if (action === "apply") await api.applyGitStash({ path: rootPath, ref });
      else if (action === "pop") await api.popGitStash({ path: rootPath, ref });
      else await api.dropGitStash({ path: rootPath, ref });
      if (selectedHash === ref) setSelectedHash(null);
      await loadStashes();
      await loadWorkingStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} that stash.`);
    } finally {
      setStashBusy(null);
    }
  };

  const submitCreateStash = async (message: string) => {
    setCreatingStash(false);
    setError(null);
    try {
      await api.createGitStash({ path: rootPath, message: message.trim() || undefined, includeUntracked: true });
      await loadStashes();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nothing to stash — the working tree is clean.");
    }
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizingSidebar.current = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let currentWidth = startWidth;
    const maxWidth = () => {
      if (window.innerWidth < 1024) return 400;
      const mainMinimum = selectedHash || showWorking ? 360 : 280;
      return Math.max(200, Math.min(400, window.innerWidth - mainMinimum - 320));
    };
    const move = (moveEvent: PointerEvent) => {
      if (!resizingSidebar.current) return;
      currentWidth = Math.min(maxWidth(), Math.max(200, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(currentWidth);
    };
    const end = () => {
      resizingSidebar.current = false;
      setPanelSize(panelKey, currentWidth);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const filteredCommits = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return commits;
    return commits.filter(
      (commit) =>
        commit.subject.toLowerCase().includes(query) ||
        commit.author.toLowerCase().includes(query) ||
        commit.hash.startsWith(query)
    );
  }, [commits, filter]);

  const isFiltering = filter.trim().length > 0;
  const { rows, maxLanes } = useMemo(() => layoutGraph(commits), [commits]);
  const rowsByHash = useMemo(() => new Map(rows.map((row) => [row.commit.hash, row])), [rows]);
  const visibleRows = isFiltering
    ? filteredCommits.map((commit) => rowsByHash.get(commit.hash)).filter((row): row is GraphRow => Boolean(row))
    : rows;

  const localBranches = branches
    .filter((branch) => !branch.remote)
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  const remoteBranches = branches.filter((branch) => branch.remote);
  const remoteBranchGroups = useMemo(() => {
    const groups = new Map<string, GitBranchSummary[]>();
    for (const branch of remoteBranches) {
      const separator = branch.name.indexOf("/");
      const remote = separator === -1 ? "Remote" : branch.name.slice(0, separator);
      const entries = groups.get(remote) ?? [];
      entries.push(branch);
      groups.set(remote, entries);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([remote, entries]) => [remote, entries.sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [remoteBranches]);

  const toggleRemote = (remote: string) => {
    setCollapsedRemotes((current) => {
      const next = new Set(current);
      if (next.has(remote)) next.delete(remote);
      else next.add(remote);
      return next;
    });
  };

  if (notARepo && !branchesLoading) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 bg-neutral-950 px-6 text-center">
        <GitCommitHorizontal size={28} className="text-neutral-700" />
        <p className="text-sm font-medium text-neutral-300">Not a git repository</p>
        <p className="max-w-xs text-xs text-neutral-600">Initialize git for this project from the file browser or status panel to see its history here.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-neutral-950">
      <div
        className="hidden min-h-0 shrink-0 flex-col bg-neutral-900/35 md:flex md:w-[var(--git-sidebar-width)]"
        style={{ "--git-sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
          <div role="tablist" aria-label="Git panels" className="flex h-7 min-w-0 items-center gap-0.5 rounded-lg bg-neutral-900/70 p-0.5">
            {(["branches", "stash"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={sidebarTab === tab}
                onClick={() => setSidebarTab(tab)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium capitalize transition-colors",
                  sidebarTab === tab ? "bg-neutral-700/80 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
                )}
              >
                {tab === "branches" ? <GitBranch size={12} /> : <Archive size={12} />}
                {tab}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {sidebarTab === "stash" && (
              <button
                type="button"
                title="Stash current changes"
                onClick={() => setCreatingStash(true)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              >
                <Plus size={13} />
              </button>
            )}
            <button
              type="button"
              title="Fetch"
              onClick={() => void fetchRemote()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              {fetching ? <LoaderCircle size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            </button>
            <button
              type="button"
              title="Refresh"
              onClick={refresh}
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {sidebarTab === "branches" ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-2 pb-3">
            <button
              type="button"
              onClick={() => {
                setSelectedBranch(undefined);
                setSelectedHash(null);
                setShowWorking(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium transition-colors",
                selectedBranch === undefined ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              )}
            >
              <GitCommitHorizontal size={14} className={cn("shrink-0", selectedBranch === undefined ? "text-emerald-400" : "text-neutral-600")} />
              <span className="min-w-0 flex-1">All history</span>
              <span className="text-[10px] font-normal text-neutral-600">{commits.length || ""}</span>
            </button>

            <section className="space-y-1">
              <p className="flex items-center justify-between px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                <span>Local branches</span>
                <span>{localBranches.length}</span>
              </p>
              {localBranches.map((branch) => (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  selected={selectedBranch === branch.name}
                  checkingOut={checkingOut === branch.name}
                  pulling={pulling && branch.current}
                  onSelect={() => {
                    setSelectedBranch(branch.name);
                    setSelectedHash(null);
                    setShowWorking(false);
                  }}
                  onCheckout={() => void checkout(branch.name)}
                  onPull={() => void pull()}
                />
              ))}
            </section>
            {remoteBranchGroups.length > 0 && (
              <section className="space-y-1">
                <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600">Remotes</p>
                {remoteBranchGroups.map(([remote, remoteGroup]) => {
                  const collapsed = collapsedRemotes.has(remote);
                  return (
                    <div key={remote} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => toggleRemote(remote)}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
                      >
                        <ChevronDown size={13} className={cn("shrink-0 transition-transform", collapsed && "-rotate-90")} />
                        <span className="min-w-0 flex-1 truncate">{remote}</span>
                        <span className="text-[10px] font-normal text-neutral-700">{remoteGroup.length}</span>
                      </button>
                      {!collapsed && remoteGroup.map((branch) => (
                        <BranchRow
                          key={branch.name}
                          branch={branch}
                          label={branch.name.slice(remote.length + 1)}
                          selected={selectedBranch === branch.name}
                          checkingOut={checkingOut === branch.name}
                          pulling={false}
                          onSelect={() => {
                            setSelectedBranch(branch.name);
                            setSelectedHash(null);
                            setShowWorking(false);
                          }}
                          onCheckout={() => void checkout(branch.name)}
                          onPull={() => undefined}
                        />
                      ))}
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-3">
            {creatingStash && (
              <div className="px-0.5 py-1">
                <Input
                  autoFocus
                  placeholder="Stash message (optional)"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitCreateStash(event.currentTarget.value);
                    else if (event.key === "Escape") setCreatingStash(false);
                  }}
                  onBlur={(event) => void submitCreateStash(event.currentTarget.value)}
                />
              </div>
            )}
            {stashesLoading && (
              <div className="flex items-center gap-2 px-2 py-4 text-xs text-neutral-600">
                <LoaderCircle size={13} className="animate-spin" /> Loading stashes…
              </div>
            )}
            {!stashesLoading && stashes.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-neutral-600">No stashes.</p>
            )}
            {stashes.map((stash) => (
              <StashRow
                key={stash.ref}
                stash={stash}
                active={selectedHash === stash.ref}
                busy={stashBusy === stash.ref}
                onSelect={() => setSelectedHash(stash.ref)}
                onApply={() => void runStashAction(stash.ref, "apply")}
                onPop={() => void runStashAction(stash.ref, "pop")}
                onDrop={() => {
                  if (window.confirm(`Drop ${stash.ref}? This can't be undone.`)) void runStashAction(stash.ref, "drop");
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className="group relative hidden w-px shrink-0 md:flex"
        role="separator"
        aria-label="Resize Git sidebar"
        aria-valuemin={200}
        aria-valuemax={400}
        aria-valuenow={sidebarWidth}
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize touch-none" onPointerDown={startSidebarResize} />
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-600/60" />
      </div>

      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", selectedHash || showWorking ? "hidden lg:flex" : "flex")}>
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <div className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-neutral-900/70 px-2.5 text-neutral-500 transition-colors focus-within:bg-neutral-900 focus-within:text-neutral-300">
            <Search size={13} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by message, author or hash"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {logLoading && (
            <div className="flex items-center gap-2 px-2 py-6 text-xs text-neutral-600">
              <LoaderCircle size={14} className="animate-spin" /> Loading history…
            </div>
          )}
          {error && <p className="px-2 py-2 text-[11px] text-red-400">{error}</p>}
          {!logLoading && visibleRows.length === 0 && !workingStatus?.files.length && (
            <p className="px-2 py-6 text-center text-xs text-neutral-600">No commits match.</p>
          )}
          <div className="space-y-px">
            {!isFiltering && workingStatus && (
              <button
                type="button"
                onClick={() => {
                  setShowWorking(true);
                  setSelectedHash(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
                  showWorking ? "bg-neutral-800" : "hover:bg-neutral-900/70"
                )}
                style={{ height: ROW_H }}
              >
                <svg width={LANE_W} height={ROW_H} className="shrink-0">
                  <circle
                    cx={LANE_W / 2}
                    cy={ROW_H / 2}
                    r={DOT_R}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    strokeDasharray="2.5 2"
                  />
                </svg>
                <span className={cn("min-w-0 flex-1 truncate text-[12.5px] font-medium", showWorking ? "text-neutral-100" : workingStatus.files.length ? "text-amber-300/90" : "text-neutral-400")}>
                  Working tree
                </span>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", workingStatus.files.length ? "bg-amber-500/15 text-amber-300" : "bg-neutral-800/80 text-neutral-600")}>
                  {workingStatus.files.length ? `${workingStatus.files.length} changed` : "clean"}
                </span>
              </button>
            )}
            {visibleRows.map((row) => (
              <CommitRow
                key={row.commit.hash}
                row={row}
                showGraph={!isFiltering}
                maxLanes={maxLanes}
                active={row.commit.hash === selectedHash}
                compact={Boolean(selectedHash || showWorking)}
                onSelect={() => {
                  setSelectedHash(row.commit.hash);
                  setShowWorking(false);
                }}
              />
            ))}
          </div>
          {!isFiltering && hasMore && (
            <button
              type="button"
              onClick={() => void loadLog(selectedBranch, commits.length)}
              disabled={loadingMore}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[11px] text-neutral-500 hover:bg-neutral-900/70 hover:text-neutral-300 disabled:opacity-50"
            >
              {loadingMore ? <LoaderCircle size={12} className="animate-spin" /> : null}
              Load older commits
            </button>
          )}
        </div>
      </div>

      {showWorking && workingStatus && (
        <WorkingChanges
          projectPath={rootPath}
          status={workingStatus}
          onClose={() => setShowWorking(false)}
          onChanged={() => {
            void loadWorkingStatus();
            void loadLog(selectedBranch, 0);
          }}
        />
      )}
      {!showWorking && selectedHash && (
        <CommitDetail projectPath={rootPath} hash={selectedHash} onClose={() => setSelectedHash(null)} />
      )}
    </div>
  );
};
