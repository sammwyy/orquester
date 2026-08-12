import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  GitBranchesResponse,
  GitBranchSummary,
  GitCommitDetail,
  GitCommitFile,
  GitLogResponse,
  GitStashSummary,
  GitStatusResponse
} from "@orquester/api";

const execFileAsync = promisify(execFile);

export async function isGitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function git(projectPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", projectPath, ...args], {
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  return result.stdout;
}

async function assertProjectRepository(projectPath: string): Promise<void> {
  await stat(join(projectPath, ".git"));
}

export async function initializeGit(projectPath: string): Promise<GitStatusResponse> {
  await execFileAsync("git", ["-C", projectPath, "init"], {
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  return readGitStatus(projectPath);
}

export async function readGitStatus(projectPath: string): Promise<GitStatusResponse> {
  await assertProjectRepository(projectPath);
  const branchOutput = await git(projectPath, ["branch", "--show-current"]);
  const branch = branchOutput.trim() || "HEAD";
  const [originOutput, logOutput, filesOutput] = await Promise.all([
    git(projectPath, ["remote", "get-url", "origin"]).catch(() => ""),
    git(projectPath, ["log", "-5", "--format=%H%x09%an%x09%aI%x09%s"]).catch(() => ""),
    git(projectPath, ["status", "--porcelain=v1"]).catch(() => "")
  ]);
  const diffOutput = await git(projectPath, ["diff", "--numstat", "HEAD"]).catch(() => "");
  const diff = diffOutput.split(/\r?\n/).filter(Boolean).reduce(
    (total, line) => {
      const [additions, deletions] = line.split("\t");
      const added = Number(additions);
      const removed = Number(deletions);
      if (Number.isFinite(added)) total.additions += added;
      if (Number.isFinite(removed)) total.deletions += removed;
      return total;
    },
    { additions: 0, deletions: 0 }
  );

  return {
    projectPath,
    branch,
    origin: originOutput.trim() || undefined,
    ...diff,
    commits: logOutput.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash = "", author = "", date = "", ...subject] = line.split("\t");
      return { hash, author, date, subject: subject.join("\t") };
    }),
    files: filesOutput.split(/\r?\n/).filter(Boolean).map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3)
    }))
  };
}

// Field/record separators for machine-parseable `git log`/`for-each-ref` output —
// control characters no commit message or ref name will ever contain, so
// splitting never mistakes message content for a field boundary.
const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

async function currentHeadInfo(projectPath: string): Promise<{ branch: string | null; detachedAt: string | null }> {
  try {
    const branch = (await git(projectPath, ["symbolic-ref", "-q", "--short", "HEAD"])).trim();
    return { branch: branch || null, detachedAt: null };
  } catch {
    const hash = await git(projectPath, ["rev-parse", "HEAD"]).then((out) => out.trim()).catch(() => "");
    return { branch: null, detachedAt: hash || null };
  }
}

function parseTrack(track: string): { ahead: number; behind: number } {
  let ahead = 0;
  let behind = 0;
  for (const match of track.matchAll(/ahead (\d+)|behind (\d+)/g)) {
    if (match[1]) ahead = Number(match[1]);
    if (match[2]) behind = Number(match[2]);
  }
  return { ahead, behind };
}

/** Local + remote-tracking branches, with ahead/behind vs their upstream and which one HEAD is on. */
export async function listBranches(projectPath: string): Promise<GitBranchesResponse> {
  await assertProjectRepository(projectPath);
  // %(refname) (full) is only used to reliably filter out a remote's symbolic HEAD
  // pointer — its refname:short collapses to a bare "origin", not "origin/HEAD",
  // so filtering on the short name alone would let it through as a fake branch.
  const format = `%(refname)${FIELD_SEP}%(refname:short)${FIELD_SEP}%(objectname)${FIELD_SEP}%(upstream:short)${FIELD_SEP}%(HEAD)${FIELD_SEP}%(upstream:track)`;
  const [localOut, remoteOut, head] = await Promise.all([
    git(projectPath, ["for-each-ref", "refs/heads", `--format=${format}`]).catch(() => ""),
    git(projectPath, ["for-each-ref", "refs/remotes", `--format=${format}`]).catch(() => ""),
    currentHeadInfo(projectPath)
  ]);

  const parseRefs = (output: string, remote: boolean): GitBranchSummary[] =>
    output
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.split(FIELD_SEP)[0]?.endsWith("/HEAD"))
      .map((line) => {
        const [, name = "", commitHash = "", upstream = "", headMarker = "", track = ""] = line.split(FIELD_SEP);
        return {
          name,
          remote,
          current: !remote && headMarker === "*",
          commitHash,
          upstream: upstream || undefined,
          ...parseTrack(track)
        };
      });

  return {
    branches: [...parseRefs(localOut, false), ...parseRefs(remoteOut, true)],
    currentBranch: head.branch,
    detachedAt: head.detachedAt
  };
}

/** Commit log with parent hashes (for the graph) and ref decorations, newest first. */
export async function readLog(
  projectPath: string,
  options: { branch?: string; limit: number; skip: number }
): Promise<GitLogResponse> {
  await assertProjectRepository(projectPath);
  const format = `%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%s${RECORD_SEP}`;
  const output = await git(projectPath, [
    "log",
    options.branch || "--all",
    `--format=${format}`,
    "-n",
    String(options.limit + 1),
    `--skip=${options.skip}`
  ]).catch(() => "");

  const records = output.split(RECORD_SEP).map((record) => record.trim()).filter(Boolean);
  const commits = records.slice(0, options.limit).map((record) => {
    const [hash = "", parents = "", author = "", authorEmail = "", date = "", refs = "", subject = ""] =
      record.split(FIELD_SEP);
    return {
      hash,
      parents: parents.split(" ").filter(Boolean),
      author,
      authorEmail,
      date,
      subject,
      refs: refs.split(",").map((ref) => ref.trim()).filter(Boolean)
    };
  });

  return { commits, hasMore: records.length > options.limit };
}

/** Full detail for one commit: message body, per-file stats, and the unified diff patch. */
export async function readCommit(projectPath: string, hash: string): Promise<GitCommitDetail> {
  await assertProjectRepository(projectPath);
  const format = `%H${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b`;
  const metaOut = await git(projectPath, ["show", "-s", `--format=${format}`, hash]);

  const [metaHash = "", parents = "", author = "", authorEmail = "", date = "", subject = "", ...bodyParts] =
    metaOut.split(FIELD_SEP);
  const parentHashes = parents.split(" ").filter(Boolean);

  // A merge commit's `git show` defaults to a "combined diff" (against ALL parents at
  // once — different hunk syntax our parser doesn't speak, and often empty for a clean
  // merge with nothing to reconcile). Diffing against just the first parent instead
  // matches what every other git client shows for a merge, and — since a stash is
  // internally a merge commit too (parent 1 = original HEAD) — this is also exactly
  // "what would applying this stash change," with no special-casing needed for stashes.
  const isMerge = parentHashes.length > 0;
  const range = isMerge ? [`${parentHashes[0]}..${metaHash}`] : [hash];
  // `git diff` takes no --format (it never prints a commit header); `git show` needs
  // --format= to suppress one, for the root-commit case where there's no parent to diff against.
  const [statusOut, numstatOut, diffOut] = await Promise.all([
    git(projectPath, isMerge ? ["diff", "--name-status", ...range] : ["show", "--format=", "--name-status", ...range]).catch(() => ""),
    git(projectPath, isMerge ? ["diff", "--numstat", ...range] : ["show", "--format=", "--numstat", ...range]).catch(() => ""),
    git(projectPath, isMerge ? ["diff", ...range] : ["show", "--format=", ...range]).catch(() => "")
  ]);

  const statusByPath = new Map<string, string>();
  for (const line of statusOut.split(/\r?\n/).filter(Boolean)) {
    const [status = "", ...rest] = line.split("\t");
    const path = rest[rest.length - 1];
    if (path) statusByPath.set(path, status);
  }

  const files: GitCommitFile[] = numstatOut
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, path = ""] = line.split("\t");
      return {
        path,
        status: statusByPath.get(path) ?? "M",
        additions: Number(additions) || 0,
        deletions: Number(deletions) || 0
      };
    });

  return {
    hash: metaHash,
    parents: parentHashes,
    author,
    authorEmail,
    date,
    subject,
    body: bodyParts.join(FIELD_SEP).trim(),
    files,
    diff: diffOut
  };
}

/** Switches branches; throws with git's own message (e.g. dirty working tree) on failure. */
export async function checkoutRef(projectPath: string, ref: string): Promise<GitStatusResponse> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["checkout", ref]);
  return readGitStatus(projectPath);
}

/** Updates every remote-tracking branch (and ahead/behind counts) without touching the working tree. */
export async function fetchAll(projectPath: string): Promise<GitBranchesResponse> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["fetch", "--all", "--prune"]);
  return listBranches(projectPath);
}

/**
 * Fetches and merges the current branch's upstream. `--no-rebase` pins the strategy
 * explicitly — modern git otherwise refuses divergent histories until the reconcile
 * mode is configured, which would surface as a confusing error in a GUI with no
 * terminal to read the hint in. `--no-edit` accepts the default merge message rather
 * than trying to open an editor, which would just hang here.
 */
export async function pullCurrentBranch(projectPath: string): Promise<GitStatusResponse> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["pull", "--no-rebase", "--no-edit"]);
  return readGitStatus(projectPath);
}

const STASH_SUBJECT_RE = /^(?:On|WIP on) ([^:]+): (.*)$/;

export async function listStashes(projectPath: string): Promise<GitStashSummary[]> {
  await assertProjectRepository(projectPath);
  const format = `%H${FIELD_SEP}%gd${FIELD_SEP}%gs${FIELD_SEP}%aI`;
  const output = await git(projectPath, ["stash", "list", `--format=${format}`]).catch(() => "");
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const [hash = "", ref = "", subject = "", date = ""] = line.split(FIELD_SEP);
      const match = subject.match(STASH_SUBJECT_RE);
      return { index, ref, hash, branch: match?.[1] ?? "", message: match?.[2] ?? subject, date };
    });
}

/** Applies a stash without removing it; throws with git's own message on conflict. */
export async function applyStash(projectPath: string, ref: string): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["stash", "apply", ref]);
}

/** Applies a stash and removes it; throws (leaving the stash intact) on conflict. */
export async function popStash(projectPath: string, ref: string): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["stash", "pop", ref]);
}

export async function dropStash(projectPath: string, ref: string): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["stash", "drop", ref]);
}

/** Stashes the current working tree changes (and index); throws if there's nothing to stash. */
export async function createStash(projectPath: string, message?: string, includeUntracked?: boolean): Promise<void> {
  await assertProjectRepository(projectPath);
  const args = ["stash", "push"];
  if (includeUntracked) args.push("-u");
  if (message) args.push("-m", message);
  await git(projectPath, args);
}

/**
 * Diff for one working-tree file, staged or unstaged. `git diff`/`git diff --cached`
 * always exit 0 (unlike `--no-index`), so no special error handling is needed there —
 * but untracked files never show up in a diff at all, so those are synthesized as an
 * all-added patch from the raw file content instead of shelling out to diff.
 */
export async function readWorkingDiff(projectPath: string, file: string, staged: boolean): Promise<string> {
  await assertProjectRepository(projectPath);
  if (!staged) {
    const status = await git(projectPath, ["status", "--porcelain=v1", "--", file]).catch(() => "");
    if (status.startsWith("??")) {
      const content = await readFile(join(projectPath, file), "utf8").catch(() => "");
      // A trailing newline splits into a trailing "" element that isn't really an extra line.
      const lines = content.length ? content.replace(/\r?\n$/, "").split(/\r?\n/) : [];
      const body = lines.map((line) => `+${line}`).join("\n");
      return `diff --git a/${file} b/${file}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
    }
  }
  return git(projectPath, staged ? ["diff", "--cached", "--", file] : ["diff", "--", file]).catch(() => "");
}

export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["add", "--", ...files]);
}

export async function unstageFiles(projectPath: string, files: string[]): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["restore", "--staged", "--", ...files]);
}

/**
 * Discards uncommitted changes to the given paths. Tracked and untracked files need
 * different commands (`restore` only knows tracked paths; `clean` only touches
 * untracked ones) — running both and swallowing the "doesn't apply" failure from
 * whichever one doesn't match avoids having to know each path's type up front.
 */
export async function discardFiles(projectPath: string, files: string[]): Promise<void> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["clean", "-fd", "--", ...files]).catch(() => undefined);
  await git(projectPath, ["restore", "--", ...files]).catch(() => undefined);
}

export async function commitChanges(projectPath: string, message: string): Promise<GitStatusResponse> {
  await assertProjectRepository(projectPath);
  await git(projectPath, ["commit", "-m", message]);
  return readGitStatus(projectPath);
}

export interface GitProjectWatcher {
  setActive(active: boolean): void;
  watch(projectPath: string): void;
  stop(): void;
}

export function watchGitProjects(
  workspacesDir: string,
  onChange: (status: GitStatusResponse) => void
): GitProjectWatcher {
  const previous = new Map<string, string>();
  const watchers = new Map<string, FSWatcher>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const maxTimers = new Map<string, NodeJS.Timeout>();
  let active = false;
  let stopped = false;

  const refresh = async (projectPath: string) => {
    try {
      const status = await readGitStatus(projectPath);
      const serialized = JSON.stringify(status);
      if (previous.has(projectPath) && previous.get(projectPath) !== serialized) onChange(status);
      previous.set(projectPath, serialized);
    } catch {
      previous.delete(projectPath);
    }
  };

  const schedule = (projectPath: string) => {
    clearTimeout(debounceTimers.get(projectPath));
    debounceTimers.set(projectPath, setTimeout(() => {
      debounceTimers.delete(projectPath);
      clearTimeout(maxTimers.get(projectPath));
      maxTimers.delete(projectPath);
      void refresh(projectPath);
    }, 750));
    if (!maxTimers.has(projectPath)) {
      maxTimers.set(projectPath, setTimeout(() => {
        debounceTimers.delete(projectPath);
        maxTimers.delete(projectPath);
        void refresh(projectPath);
      }, 3_000));
    }
  };

  const addProject = async (projectPath: string) => {
    if (watchers.has(projectPath)) return;
    try {
      await refresh(projectPath);
      const projectWatcher = watch(projectPath, { recursive: true }, () => schedule(projectPath));
      projectWatcher.on("error", () => {
        projectWatcher.close();
        watchers.delete(projectPath);
      });
      watchers.set(projectPath, projectWatcher);
    } catch {
      // Non-git project directories are intentionally ignored.
    }
  };

  const discover = async () => {
    if (!active || stopped) return;
    const workspaces = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
    for (const workspace of workspaces) {
      if (!workspace.isDirectory() || workspace.name.startsWith(".")) continue;
      const projects = await readdir(join(workspacesDir, workspace.name), { withFileTypes: true }).catch(() => []);
      for (const project of projects) {
        if (project.isDirectory() && !project.name.startsWith(".")) {
          await addProject(join(workspacesDir, workspace.name, project.name));
        }
      }
    }
  };

  const clear = () => {
    for (const projectWatcher of watchers.values()) projectWatcher.close();
    watchers.clear();
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    for (const timer of maxTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
    maxTimers.clear();
    previous.clear();
  };

  return {
    setActive(nextActive) {
      if (stopped || active === nextActive) return;
      active = nextActive;
      if (active) void discover();
      else clear();
    },
    watch(projectPath) {
      if (active && !stopped) void addProject(projectPath);
    },
    stop() {
      stopped = true;
      active = false;
      clear();
    }
  };
}
