import React, { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, LoaderCircle } from "lucide-react";
import type { GitCommitDetail } from "@orquester/api";
import { cn } from "../../lib/cn";
import { useApi } from "../../context/orquester-context";
import { FileTypeIcon } from "../files";
import { Avatar } from "./Avatar";
import { parseUnifiedDiff } from "./diff";

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  A: { label: "added", className: "text-emerald-400" },
  M: { label: "modified", className: "text-amber-400" },
  D: { label: "deleted", className: "text-red-400" },
  C: { label: "copied", className: "text-sky-400" }
};

const statusInfo = (status: string) => {
  const letter = status[0] ?? "M";
  if (letter === "R") return { label: `renamed${status.slice(1) ? ` ${status.slice(1)}%` : ""}`, className: "text-sky-400" };
  return STATUS_INFO[letter] ?? { label: status, className: "text-neutral-400" };
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"]
  ];
  let value = seconds;
  for (const [span, unit] of units) {
    if (value < span) {
      const rounded = Math.floor(value);
      return rounded <= 1 && unit === "second" ? "just now" : `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
    }
    value /= span;
  }
  return iso;
};

const formatAbsolute = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export const CommitDetail: React.FC<{
  projectPath: string;
  hash: string;
  onClose: () => void;
}> = ({ projectPath, hash, onClose }) => {
  const api = useApi();
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setState("loading");
    setDetail(null);
    api
      .gitCommit(projectPath, hash)
      .then((res) => {
        if (!active) return;
        setDetail(res);
        setState("idle");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [api, projectPath, hash]);

  const files = detail ? parseUnifiedDiff(detail.diff) : [];
  const diffByPath = new Map(files.map((file) => [file.newPath === "/dev/null" ? file.oldPath : file.newPath, file]));

  const copyHash = () => {
    void navigator.clipboard.writeText(hash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-neutral-900/25 md:w-[22rem] md:shrink-0 lg:w-[clamp(20rem,30vw,26rem)]">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-label="Close commit"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          onClick={copyHash}
          title="Copy full hash"
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 font-mono text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          {hash.slice(0, 10)}
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {state === "loading" && (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-neutral-600">
            <LoaderCircle size={14} className="animate-spin" /> Loading commit…
          </div>
        )}
        {state === "error" && <p className="px-4 py-6 text-xs text-red-400">Could not load this commit.</p>}

        {state === "idle" && detail && (
          <>
            <div className="space-y-3 px-4 pb-4 pt-1">
              <p className="whitespace-pre-wrap text-[13px] font-medium leading-snug text-neutral-100">{detail.subject}</p>
              {detail.body && (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-400">{detail.body}</p>
              )}
              <div className="flex items-center gap-2.5 pt-1">
                <Avatar name={detail.author} size={28} />
                <div className="min-w-0 text-[11px] leading-tight">
                  <p className="truncate text-neutral-300">{detail.author}</p>
                  <p className="truncate text-neutral-600" title={formatAbsolute(detail.date)}>
                    {formatRelative(detail.date)}
                  </p>
                </div>
              </div>
              {detail.parents.length > 1 && (
                <p className="text-[10px] text-neutral-600">
                  Merge of {detail.parents.map((parent) => parent.slice(0, 7)).join(" + ")}
                </p>
              )}
            </div>

            <div className="space-y-0.5 px-2 pb-3">
              {detail.files.map((file) => {
                const info = statusInfo(file.status);
                return (
                  <div key={file.path} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]">
                    <FileTypeIcon name={file.path} size={13} />
                    <span className="min-w-0 flex-1 truncate text-neutral-300">{file.path}</span>
                    <span className={cn("shrink-0 text-[10px]", info.className)}>{info.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-neutral-600">
                      {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                      {file.additions > 0 && file.deletions > 0 && " "}
                      {file.deletions > 0 && <span className="text-red-500">-{file.deletions}</span>}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 px-3 pb-6">
              {detail.files.map((file) => {
                const diffFile = diffByPath.get(file.path);
                if (!diffFile) return null;
                return (
                  <div key={file.path} className="overflow-hidden rounded-xl bg-neutral-950">
                    <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-neutral-400">
                      <FileTypeIcon name={file.path} size={13} />
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    </div>
                    {diffFile.isBinary ? (
                      <p className="px-3 pb-3 text-[10px] text-neutral-600">Binary file not shown.</p>
                    ) : (
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
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
