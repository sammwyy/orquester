import React, { useState } from "react";
import { ArrowUp, File, Folder, Home, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";
import { useApi } from "../../context/orquester-context";
import { useAsyncResource } from "../../hooks";
import type { FsListResponse } from "@orquester/api";

const EMPTY: FsListResponse = { path: "", parent: null, entries: [] };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Minimal directory browser for a project, backed by the daemon FS endpoint. */
export const FileBrowser: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const api = useApi();
  const [cwd, setCwd] = useState(rootPath);
  const { data, loading, error, reload } = useAsyncResource<FsListResponse>(
    (signal) => api.listFiles(cwd, signal),
    EMPTY,
    [api, cwd]
  );

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
        <IconAction label="Home" onClick={() => setCwd(rootPath)}>
          <Home size={14} />
        </IconAction>
        <IconAction
          label="Up"
          disabled={!data.parent}
          onClick={() => data.parent && setCwd(data.parent)}
        >
          <ArrowUp size={14} />
        </IconAction>
        <IconAction label="Refresh" onClick={reload}>
          <RefreshCw size={13} />
        </IconAction>
        <span className="ml-1 flex-1 truncate font-mono text-xs text-neutral-500">{cwd}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && data.entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-neutral-600">Loading…</p>
        )}
        {error && <p className="px-3 py-2 text-xs text-red-400">{error.message}</p>}
        {!loading && !error && data.entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-neutral-600">Empty directory</p>
        )}
        {data.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onDoubleClick={() => entry.kind === "dir" && setCwd(entry.path)}
            onClick={() => entry.kind === "dir" && setCwd(entry.path)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1 text-left text-sm",
              entry.kind === "dir"
                ? "text-neutral-200 hover:bg-neutral-800"
                : "text-neutral-400 hover:bg-neutral-900"
            )}
          >
            {entry.kind === "dir" ? (
              <Folder size={14} className="shrink-0 text-neutral-500" />
            ) : (
              <File size={14} className="shrink-0 text-neutral-600" />
            )}
            <span className="flex-1 truncate">{entry.name}</span>
            {entry.kind === "file" && (
              <span className="text-[10px] text-neutral-600">{formatSize(entry.size)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

const IconAction: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, disabled, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30"
  >
    {children}
  </button>
);
