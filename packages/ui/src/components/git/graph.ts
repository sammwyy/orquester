import type { GitCommitSummary } from "@orquester/api";

/** Stable per-lane color cycle (blue, emerald, amber, pink, violet, cyan, orange, lime). */
export const LANE_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#a3e635"
];

export const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length];

export interface GraphEdge {
  fromCol: number;
  toCol: number;
  colorIndex: number;
}

/** A drawable instruction for one row's local SVG (coordinates resolved at render time from `col`/half). */
export type GraphSegment =
  | { kind: "line"; col: number; colorIndex: number; half: "top" | "bottom" | "full" }
  | { kind: "curve"; fromCol: number; toCol: number; colorIndex: number; half: "top" | "bottom" }
  | { kind: "dot"; col: number; colorIndex: number; isMerge: boolean; isRoot: boolean; isTip: boolean };

export interface GraphRow {
  commit: GitCommitSummary;
  col: number;
  colorIndex: number;
  segments: GraphSegment[];
}

export interface GraphLayout {
  rows: GraphRow[];
  maxLanes: number;
}

interface LaneState {
  hash: string | null;
  colorIndex: number;
}

/**
 * Assigns each commit a lane (column) and produces per-row drawing segments for a
 * DAG graph, in the classic "gitk"-style single pass: lanes are never shifted once
 * created (only freed and reused), so rendering never has to re-flow earlier rows.
 *
 * The one subtlety that isn't obvious from a first pass: two different children can
 * name the *same* parent hash (an ordinary fork point). Naively, both would try to
 * claim their own lane for it. This checks for an existing lane before opening a new
 * one for *every* parent (first or merge), so forks converge into one lane instead of
 * leaving a stale, never-consumed duplicate.
 */
export function layoutGraph(commits: GitCommitSummary[]): GraphLayout {
  const lanes: LaneState[] = [];
  const rows: GraphRow[] = [];
  let colorCounter = 0;

  const findFreeLane = (): number => {
    const idx = lanes.findIndex((lane) => lane.hash === null);
    if (idx !== -1) return idx;
    lanes.push({ hash: null, colorIndex: 0 });
    return lanes.length - 1;
  };

  for (const commit of commits) {
    let col = lanes.findIndex((lane) => lane.hash === commit.hash);
    let colorIndex: number;
    const isTip = col === -1;
    if (isTip) {
      col = findFreeLane();
      colorIndex = colorCounter++ % LANE_COLORS.length;
    } else {
      colorIndex = lanes[col].colorIndex;
    }

    const lanesBefore = lanes.map((lane) => ({ ...lane }));
    lanes[col] = { hash: null, colorIndex };

    const edgesOut: GraphEdge[] = [];
    const [firstParent, ...restParents] = commit.parents;

    if (firstParent) {
      const existing = lanes.findIndex((lane) => lane.hash === firstParent);
      if (existing !== -1 && existing !== col) {
        edgesOut.push({ fromCol: col, toCol: existing, colorIndex: lanes[existing].colorIndex });
      } else {
        lanes[col] = { hash: firstParent, colorIndex };
        edgesOut.push({ fromCol: col, toCol: col, colorIndex });
      }
    }
    for (const parentHash of restParents) {
      const existing = lanes.findIndex((lane) => lane.hash === parentHash);
      if (existing !== -1) {
        edgesOut.push({ fromCol: col, toCol: existing, colorIndex: lanes[existing].colorIndex });
      } else {
        const free = findFreeLane();
        const mergeColor = colorCounter++ % LANE_COLORS.length;
        lanes[free] = { hash: parentHash, colorIndex: mergeColor };
        edgesOut.push({ fromCol: col, toCol: free, colorIndex: mergeColor });
      }
    }

    const segments: GraphSegment[] = [];
    const touched = new Set<number>([col, ...edgesOut.map((edge) => edge.toCol)]);

    // Passthrough verticals for every other lane still alive on both sides of this row.
    const maxLen = Math.max(lanesBefore.length, lanes.length);
    for (let i = 0; i < maxLen; i++) {
      if (touched.has(i)) continue;
      const before = lanesBefore[i];
      const after = lanes[i];
      if (before?.hash && after?.hash && before.hash === after.hash) {
        segments.push({ kind: "line", col: i, colorIndex: before.colorIndex, half: "full" });
      }
    }

    // Incoming half: a line from above only if this lane was already expected (not a fresh tip).
    if (!isTip) {
      segments.push({ kind: "line", col, colorIndex, half: "top" });
    }

    // Outgoing half(s): straight for a same-column continuation, a curve for a lane change.
    for (const edge of edgesOut) {
      if (edge.fromCol === edge.toCol) {
        segments.push({ kind: "line", col: edge.toCol, colorIndex: edge.colorIndex, half: "bottom" });
      } else {
        segments.push({ kind: "curve", fromCol: edge.fromCol, toCol: edge.toCol, colorIndex: edge.colorIndex, half: "bottom" });
      }
    }

    segments.push({
      kind: "dot",
      col,
      colorIndex,
      isMerge: commit.parents.length > 1,
      isRoot: commit.parents.length === 0,
      isTip
    });

    rows.push({ commit, col, colorIndex, segments });
  }

  const maxLanes = rows.reduce((max, row) => {
    const cols = row.segments.flatMap((segment) =>
      segment.kind === "curve" ? [segment.fromCol, segment.toCol] : [segment.col]
    );
    return Math.max(max, ...cols, 0);
  }, 0);

  return { rows, maxLanes: maxLanes + 1 };
}
