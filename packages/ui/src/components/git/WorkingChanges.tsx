import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Minus, Plus, Trash2 } from "lucide-react";
import type { GitStatusResponse } from "@orquester/api";
import { cn } from "../../lib/cn";
import { useApi } from "../../context/orquester-context";
import { ApiError, type ApiClient } from "../../lib/api-client";
import { Button } from "../ui";
import { FileTypeIcon } from "../files";
import { parseUnifiedDiff } from "./diff";

interface WorkingFile {
  path: string;
  code: string;
}

const STATUS_LABEL: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflict",
  "?": "untracked"
};

/** Splits the porcelain `XY path` status codes into staged (X) and unstaged/untracked (Y) buckets. */
function classifyFiles(files: GitStatusResponse["files"]): { staged: WorkingFile[]; unstaged: WorkingFile[] } {
  const staged: WorkingFile[] = [];
  const unstaged: WorkingFile[] = [];
  for (const file of files) {
    const index = file.status[0] ?? " ";
    const worktree = file.status[1] ?? " ";
    if (index !== " " && index !== "?") staged.push({ path: file.path, code: index });
    if (worktree !== " ") unstaged.push({ path: file.path, code: index === "?" ? "?" : worktree });
  }
  return { staged, unstaged };
}

const FileRow: React.FC<{
  file: WorkingFile;
  active: boolean;
  onSelect: () => void;
  actions: React.ReactNode;
}> = ({ file, active, onSelect, actions }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect()}
    className={cn(
      "group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors",
      active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
    )}
  >
    <FileTypeIcon name={file.path} size={13} />
    <span className="min-w-0 flex-1 truncate">{file.path}</span>
    <span className="shrink-0 text-[10px] text-neutral-600">{STATUS_LABEL[file.code] ?? file.code}</span>
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
      {actions}
    </span>
  </div>
);

const actionButtonClass =
  "flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-700 hover:text-neutral-100";

async function fetchDiff(api: ApiClient, projectPath: string, file: string, staged: boolean, signal: AbortSignal) {
  const res = await api.gitWorkingDiff(projectPath, file, staged, signal);
  return res.diff;
}

export const WorkingChanges: React.FC<{
  projectPath: string;
  status: GitStatusResponse;
  onClose: () => void;
  onChanged: () => void;
}> = ({ projectPath, status, onClose, onChanged }) => {
  const api = useApi();
  const { staged, unstaged } = classifyFiles(status.files);
  const [message, setMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let active = true;
    setDiffLoading(true);
    const controller = new AbortController();
    fetchDiff(api, projectPath, selected.path, selected.staged, controller.signal)
      .then((text) => active && setDiff(text))
      .catch(() => active && setDiff(null))
      .finally(() => active && setDiffLoading(false));
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, projectPath, selected]);

  const withBusy = async (path: string, action: () => Promise<unknown>) => {
    setBusyFile(path);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action failed.");
    } finally {
      setBusyFile(null);
    }
  };

  const stage = (path: string) => withBusy(path, () => api.stageGitFiles({ path: projectPath, files: [path] }));
  const unstage = (path: string) => withBusy(path, () => api.unstageGitFiles({ path: projectPath, files: [path] }));
  const discard = (path: string) => {
    if (!window.confirm(`Discard changes to ${path}? This can't be undone.`)) return;
    void withBusy(path, () => api.discardGitFiles({ path: projectPath, files: [path] }));
  };

  const stageAll = () => withBusy("__all__", () => api.stageGitFiles({ path: projectPath, files: unstaged.map((f) => f.path) }));
  const unstageAll = () => withBusy("__all__", () => api.unstageGitFiles({ path: projectPath, files: staged.map((f) => f.path) }));

  const commit = async () => {
    if (!message.trim() || staged.length === 0) return;
    setCommitting(true);
    setError(null);
    try {
      await api.commitGitChanges({ path: projectPath, message: message.trim() });
      setMessage("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not commit.");
    } finally {
      setCommitting(false);
    }
  };

  const diffFile = diff ? parseUnifiedDiff(diff)[0] : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-neutral-900/25 md:w-[26rem] md:shrink-0">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <ArrowLeft size={15} />
        </button>
        <p className="text-[12px] font-medium text-neutral-200">Uncommitted Changes</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        <div className="space-y-2 pb-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={staged.length === 0 ? "Stage files to commit…" : "Commit message"}
            rows={3}
            disabled={staged.length === 0}
            className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-2 text-[12px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus-visible:border-neutral-500 focus-visible:ring-1 focus-visible:ring-neutral-500 disabled:opacity-50"
          />
          <Button size="sm" className="w-full" disabled={!message.trim() || staged.length === 0 || committing} onClick={() => void commit()}>
            {committing ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
            Commit {staged.length > 0 && `${staged.length} file${staged.length === 1 ? "" : "s"}`}
          </Button>
        </div>

        {error && <p className="pb-2 text-[11px] text-red-400">{error}</p>}

        <div className="space-y-1 pb-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Staged ({staged.length})</p>
            {staged.length > 0 && (
              <button type="button" onClick={() => void unstageAll()} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                Unstage all
              </button>
            )}
          </div>
          {staged.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={selected?.path === file.path && selected.staged}
              onSelect={() => setSelected({ path: file.path, staged: true })}
              actions={
                busyFile === file.path ? (
                  <LoaderCircle size={12} className="animate-spin text-neutral-500" />
                ) : (
                  <button type="button" title="Unstage" onClick={() => void unstage(file.path)} className={actionButtonClass}>
                    <Minus size={12} />
                  </button>
                )
              }
            />
          ))}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Changes ({unstaged.length})</p>
            {unstaged.length > 0 && (
              <button type="button" onClick={() => void stageAll()} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                Stage all
              </button>
            )}
          </div>
          {unstaged.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              active={selected?.path === file.path && !selected.staged}
              onSelect={() => setSelected({ path: file.path, staged: false })}
              actions={
                busyFile === file.path ? (
                  <LoaderCircle size={12} className="animate-spin text-neutral-500" />
                ) : (
                  <>
                    <button type="button" title="Discard" onClick={() => discard(file.path)} className={actionButtonClass}>
                      <Trash2 size={12} />
                    </button>
                    <button type="button" title="Stage" onClick={() => void stage(file.path)} className={actionButtonClass}>
                      <Plus size={12} />
                    </button>
                  </>
                )
              }
            />
          ))}
          {staged.length === 0 && unstaged.length === 0 && (
            <p className="px-1 py-4 text-center text-[11px] text-neutral-600">Nothing to commit — working tree clean.</p>
          )}
        </div>

        {selected && (
          <div className="mt-4 overflow-hidden rounded-xl bg-neutral-950">
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-neutral-400">
              <FileTypeIcon name={selected.path} size={13} />
              <span className="min-w-0 flex-1 truncate">{selected.path}</span>
            </div>
            {diffLoading && (
              <div className="flex items-center gap-2 px-3 pb-3 text-xs text-neutral-600">
                <LoaderCircle size={13} className="animate-spin" /> Loading diff…
              </div>
            )}
            {!diffLoading && diffFile && (
              <div className="space-y-3 pb-2 font-mono text-[11px] leading-5">
                {diffFile.hunks.map((hunk, hunkIndex) => (
                  <div key={hunkIndex}>
                    <p className="px-3 py-1 text-[10px] text-neutral-600">{hunk.header}</p>
                    {hunk.lines.map((line, lineIndex) => (
                      <div
                        key={lineIndex}
                        className={cn(
                          "flex gap-2 whitespace-pre-wrap break-words px-3",
                          line.type === "add" && "bg-emerald-500/[0.07] text-emerald-300/90",
                          line.type === "del" && "bg-red-500/[0.07] text-red-300/90",
                          line.type === "context" && "text-neutral-500"
                        )}
                      >
                        <span className="w-4 shrink-0 select-none text-neutral-700">
                          {line.type === "add" ? "+" : line.type === "del" ? "−" : ""}
                        </span>
                        <span className="min-w-0 flex-1">{line.text}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {!diffLoading && !diffFile && <p className="px-3 pb-3 text-[10px] text-neutral-600">No textual diff to show.</p>}
          </div>
        )}
      </div>
    </div>
  );
};
