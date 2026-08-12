export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  isBinary: boolean;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses `git show`/`git diff` unified patch text into per-file hunks for rendering. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      current = { oldPath: "", newPath: "", isBinary: false, hunks: [] };
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.isBinary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      current.oldPath = line.slice(4).replace(/^a\//, "");
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.newPath = line.slice(4).replace(/^b\//, "");
      continue;
    }
    const hunkMatch = line.match(HUNK_RE);
    if (hunkMatch) {
      oldNo = Number(hunkMatch[1]);
      newNo = Number(hunkMatch[2]);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ type: "context", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
    // Lines starting with "\" ("\ No newline at end of file") are intentionally skipped.
  }
  if (current) files.push(current);
  return files;
}
