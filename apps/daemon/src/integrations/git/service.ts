import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GitStatusResponse } from "@orquester/api";

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
