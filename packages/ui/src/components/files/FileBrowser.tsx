import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  File,
  FileCode,
  FileCode2,
  Files,
  FilePlus,
  FileTerminal,
  FileText,
  Folder,
  FolderPlus,
  Image,
  LoaderCircle,
  MoreHorizontal,
  Palette,
  Pencil,
  Replace,
  Scissors,
  Search,
  RefreshCw,
  Settings2,
  Trash2,
  X,
  type LucideIcon
} from "lucide-react";
import type { FsEntry, FsSearchMatch } from "@orquester/api";
import { cn } from "../../lib/cn";
import { Button, ContextMenu, Dropdown, DropdownItem, DropdownLabel, Input, type ContextMenuItem } from "../ui";
import { Editor } from "./Editor";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

const parentOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/"))) || p;
const joinPath = (dir: string, name: string) => `${dir.replace(/\/$/, "")}/${name}`;
const baseName = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
const relativeToWorkspace = (path: string, rootPath: string) => {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : baseName(path);
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Extension → icon/color, so the tree and tabs read like a real IDE instead of one flat gray glyph per file. */
const FILE_ICON_BY_EXT: Record<string, { icon: LucideIcon; className: string }> = {
  ts: { icon: FileCode, className: "text-blue-400" },
  tsx: { icon: FileCode, className: "text-blue-400" },
  mts: { icon: FileCode, className: "text-blue-400" },
  cts: { icon: FileCode, className: "text-blue-400" },
  js: { icon: FileCode, className: "text-amber-300" },
  jsx: { icon: FileCode, className: "text-amber-300" },
  mjs: { icon: FileCode, className: "text-amber-300" },
  cjs: { icon: FileCode, className: "text-amber-300" },
  json: { icon: Braces, className: "text-amber-500" },
  jsonc: { icon: Braces, className: "text-amber-500" },
  md: { icon: FileText, className: "text-sky-400" },
  mdx: { icon: FileText, className: "text-sky-400" },
  css: { icon: Palette, className: "text-fuchsia-400" },
  scss: { icon: Palette, className: "text-pink-400" },
  less: { icon: Palette, className: "text-pink-400" },
  html: { icon: FileCode2, className: "text-orange-400" },
  py: { icon: FileCode, className: "text-emerald-400" },
  rs: { icon: FileCode, className: "text-orange-500" },
  go: { icon: FileCode, className: "text-cyan-400" },
  rb: { icon: FileCode, className: "text-red-400" },
  yml: { icon: Settings2, className: "text-neutral-400" },
  yaml: { icon: Settings2, className: "text-neutral-400" },
  toml: { icon: Settings2, className: "text-neutral-400" },
  sh: { icon: FileTerminal, className: "text-emerald-300" },
  bash: { icon: FileTerminal, className: "text-emerald-300" },
  png: { icon: Image, className: "text-purple-400" },
  jpg: { icon: Image, className: "text-purple-400" },
  jpeg: { icon: Image, className: "text-purple-400" },
  gif: { icon: Image, className: "text-purple-400" },
  svg: { icon: Image, className: "text-purple-400" },
  webp: { icon: Image, className: "text-purple-400" }
};

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const FileTypeIcon: React.FC<{ name: string; size?: number; className?: string }> = ({ name, size = 14, className }) => {
  const spec = FILE_ICON_BY_EXT[extOf(name)];
  const Icon = spec?.icon ?? File;
  return <Icon size={size} className={cn("shrink-0", spec?.className ?? "text-neutral-600", className)} />;
};

interface DiffPreview {
  path: string;
  before: string;
  after: string;
  matchCount: number;
}

interface TreeEntry {
  path: string;
  kind: "file" | "dir";
}

interface MenuState {
  x: number;
  y: number;
  /** Directory new files/folders (and paste) are created in. */
  dir: string;
  /** The specific row that was right-clicked, if any (blank-space clicks have none). */
  entry: TreeEntry | null;
}

type SidebarTab = "files" | "search" | "replace";

const SIDEBAR_TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: "files", label: "Files", icon: <Files size={13} /> },
  { id: "search", label: "Search", icon: <Search size={13} /> },
  { id: "replace", label: "Replace", icon: <Replace size={13} /> }
];

/**
 * File browser: a lazy file tree on the left, the selected file's content on
 * the right. Create via the toolbar or right-click context menu. Responsive:
 * on narrow screens it's a master/detail (tree, then file with a back button).
 */
export const FileBrowser: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const api = useApi();
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeDir, setActiveDir] = useState(rootPath);
  const [creating, setCreating] = useState<null | "file" | "dir">(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelKey = `${rootPath}:files`;
  const setPanelSize = useAppStore((s) => s.setPanelSize);
  const [sidebarWidth, setSidebarWidth] = useState(() => useAppStore.getState().clientUiState.panelSizes[panelKey] ?? 288);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [jumpLine, setJumpLine] = useState<number | null>(null);
  const [diffPreview, setDiffPreview] = useState<DiffPreview | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [matches, setMatches] = useState<FsSearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, { before: string; after: string }>>({});
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fsClipboard = useAppStore((s) => s.fsClipboard);
  const setFsClipboard = useAppStore((s) => s.setFsClipboard);
  const resizing = useRef(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setMatches([]);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      api
        .searchFiles(rootPath, searchQuery, searchRegex, controller.signal)
        .then((result) => {
          setMatches(result.matches);
          setSearchError(result.truncated ? "Showing the first 500 matches." : null);
        })
        .catch((reason) => {
          if (reason?.name !== "AbortError") setSearchError("Could not search this project.");
        })
        .finally(() => setSearchLoading(false));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, searchQuery, searchRegex, rootPath]);

  useEffect(() => {
    if (sidebarTab !== "replace" || !matches.length) {
      setPreviews({});
      return;
    }
    const controller = new AbortController();
    const paths = [...new Set(matches.map((match) => match.path))];
    Promise.all(
      paths.map(async (entryPath) => {
        const file = await api.readFile(entryPath, controller.signal);
        try {
          const expression = new RegExp(searchRegex ? searchQuery : escapeRegex(searchQuery), "g");
          return [entryPath, { before: file.content, after: file.content.replace(expression, replaceWith) }] as const;
        } catch {
          return [entryPath, { before: file.content, after: file.content }] as const;
        }
      })
    )
      .then((entries) => setPreviews(Object.fromEntries(entries)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, matches, searchQuery, searchRegex, sidebarTab, replaceWith]);

  const changedPreviews = Object.entries(previews).filter(([, preview]) => preview.before !== preview.after);

  const loadDir = useCallback(
    async (dir: string): Promise<FsEntry[]> => {
      try {
        const result = await api.listFiles(dir);
        setChildrenByPath((prev) => ({ ...prev, [dir]: result.entries }));
        return result.entries;
      } catch {
        return [];
      }
    },
    [api]
  );

  useEffect(() => {
    setActiveDir(rootPath);
    void loadDir(rootPath);
  }, [rootPath, loadDir]);

  const toggleDir = (path: string) => {
    setActiveDir(path);
    setSelectedEntry({ path, kind: "dir" });
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!childrenByPath[path]) {
          void loadDir(path);
        }
      }
      return next;
    });
  };

  const selectFile = (path: string) => {
    setSelectedFile(path);
    setSelectedEntry({ path, kind: "file" });
    setJumpLine(null);
    setDiffPreview(null);
    setOpenFiles((prev) => prev.includes(path) ? prev : [...prev, path]);
    setActiveDir(parentOf(path));
  };

  const closeFile = (path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((file) => file !== path);
      if (selectedFile === path) {
        const index = prev.indexOf(path);
        setSelectedFile(next[Math.max(0, index - 1)] ?? next[0] ?? null);
      }
      return next;
    });
  };

  /** Closes every open tab at or under `path` (used after deleting/moving a folder), picking a fallback active tab. */
  const closeFilesUnder = (path: string) => {
    setOpenFiles((prev) => {
      const toClose = new Set(prev.filter((p) => p === path || p.startsWith(`${path}/`)));
      if (toClose.size === 0) return prev;
      const next = prev.filter((p) => !toClose.has(p));
      setSelectedFile((prevSelected) => (prevSelected && toClose.has(prevSelected) ? next[0] ?? null : prevSelected));
      return next;
    });
  };

  /** Rewrites a path after a rename/move: exact match or a descendant under a moved directory. */
  const rewritePath = (path: string, from: string, to: string) =>
    path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;

  /** Applies a rename/move across all client-held paths (tabs, selection, tree cache) after the server call succeeds. */
  const applyPathMove = (from: string, to: string) => {
    setOpenFiles((prev) => prev.map((p) => rewritePath(p, from, to)));
    setSelectedFile((prev) => (prev ? rewritePath(prev, from, to) : prev));
    setActiveDir((prev) => rewritePath(prev, from, to));
    setSelectedEntry((prev) => (prev ? { ...prev, path: rewritePath(prev.path, from, to) } : prev));
    setExpanded((prev) => {
      const next = new Set<string>();
      prev.forEach((p) => next.add(rewritePath(p, from, to)));
      return next;
    });
    setChildrenByPath((prev) => {
      const next: Record<string, FsEntry[]> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key === from || key.startsWith(`${from}/`)) continue;
        next[key] = value;
      }
      return next;
    });
  };

  const startRename = (path: string) => setRenaming(path);

  const submitRename = async (path: string, rawName: string) => {
    setRenaming(null);
    const name = rawName.trim();
    if (!name || name === baseName(path)) return;
    const to = joinPath(parentOf(path), name);
    try {
      await api.moveFsEntry({ path, to });
      applyPathMove(path, to);
      await loadDir(parentOf(path));
    } catch {
      setError("Could not rename.");
    }
  };

  const deleteEntry = async (entry: TreeEntry) => {
    const label = entry.kind === "dir" ? "folder" : "file";
    if (!window.confirm(`Delete ${label} "${baseName(entry.path)}"? This can't be undone.`)) return;
    try {
      await api.deleteFsEntry(entry.path);
      closeFilesUnder(entry.path);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(entry.path);
        return next;
      });
      setChildrenByPath((prev) => {
        const next: Record<string, FsEntry[]> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (key === entry.path || key.startsWith(`${entry.path}/`)) continue;
          next[key] = value;
        }
        return next;
      });
      if (fsClipboard?.path === entry.path) setFsClipboard(null);
      if (selectedEntry?.path === entry.path) setSelectedEntry(null);
      await loadDir(parentOf(entry.path));
    } catch {
      setError("Could not delete.");
    }
  };

  const copyEntry = (entry: TreeEntry) => setFsClipboard({ path: entry.path, kind: entry.kind, mode: "copy" });
  const cutEntry = (entry: TreeEntry) => setFsClipboard({ path: entry.path, kind: entry.kind, mode: "cut" });

  const splitExt = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  };

  /** Picks a non-colliding name in `dir` for a paste, e.g. "file.ts" -> "file 2.ts". */
  const uniqueNameFor = (entries: FsEntry[], name: string) => {
    const taken = new Set(entries.map((e) => e.name));
    if (!taken.has(name)) return name;
    const [base, ext] = splitExt(name);
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base} ${i}${ext}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}${ext}`;
  };

  const pasteInto = async (dir: string) => {
    const clip = fsClipboard;
    if (!clip) return;
    if (clip.kind === "dir" && (dir === clip.path || dir.startsWith(`${clip.path}/`))) {
      setError("Can't paste a folder into itself.");
      return;
    }
    const entries = childrenByPath[dir] ?? (await loadDir(dir));
    const name = uniqueNameFor(entries, baseName(clip.path));
    const to = joinPath(dir, name);
    try {
      if (clip.mode === "copy") {
        await api.copyFsEntry({ path: clip.path, to });
      } else {
        await api.moveFsEntry({ path: clip.path, to });
        applyPathMove(clip.path, to);
        await loadDir(parentOf(clip.path));
        setFsClipboard(null);
      }
      await loadDir(dir);
      setExpanded((prev) => new Set(prev).add(dir));
    } catch {
      setError(clip.mode === "copy" ? "Could not copy." : "Could not move.");
    }
  };

  const openMatch = (match: FsSearchMatch) => {
    selectFile(match.path);
    setJumpLine(match.line);
  };

  const openReplacePreview = (path: string) => {
    const preview = previews[path];
    if (!preview) return;
    selectFile(path);
    setDiffPreview({
      path,
      before: preview.before,
      after: preview.after,
      matchCount: matches.filter((match) => match.path === path).length
    });
  };

  const replaceFile = async (path: string) => {
    const preview = previews[path];
    if (!preview || preview.before === preview.after) return;
    if (!window.confirm(`Replace matches in ${baseName(path)}?`)) return;
    await api.saveFile(path, preview.after);
    setMatches((prev) => prev.filter((match) => match.path !== path));
    setPreviews((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setDiffPreview(null);
    setRefreshToken((token) => token + 1);
  };

  const replaceAllMatches = async () => {
    if (!changedPreviews.length) return;
    if (!window.confirm(`Replace matches in ${changedPreviews.length} file${changedPreviews.length === 1 ? "" : "s"}?`)) return;
    await Promise.all(changedPreviews.map(([path, preview]) => api.saveFile(path, preview.after)));
    setMatches([]);
    setPreviews({});
    setDiffPreview(null);
    setRefreshToken((token) => token + 1);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    let currentWidth = startWidth;
    const move = (moveEvent: PointerEvent) => {
      if (!resizing.current) return;
      currentWidth = Math.min(440, Math.max(220, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(currentWidth);
    };
    const end = () => {
      resizing.current = false;
      setPanelSize(panelKey, currentWidth);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const startCreate = (dir: string, kind: "file" | "dir") => {
    setActiveDir(dir);
    setCreating(kind);
  };

  const submitCreate = async (name: string) => {
    const kind = creating === "dir" ? "dir" : "file";
    setCreating(null);
    setError(null);
    try {
      await api.createFsEntry(joinPath(activeDir, name), kind);
      await loadDir(activeDir);
      setExpanded((prev) => new Set(prev).add(activeDir));
    } catch {
      setError(`Could not create ${kind}.`);
    }
  };

  /** F2 / Ctrl+C / Ctrl+X / Ctrl+V / Delete on whatever tree row was last clicked. */
  const handleTreeKeyDown = (event: React.KeyboardEvent) => {
    if (renaming || creating || (event.target as HTMLElement).tagName === "INPUT") return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "F2" && selectedEntry) {
      event.preventDefault();
      startRename(selectedEntry.path);
    } else if (mod && event.key.toLowerCase() === "c" && selectedEntry) {
      event.preventDefault();
      copyEntry(selectedEntry);
    } else if (mod && event.key.toLowerCase() === "x" && selectedEntry) {
      event.preventDefault();
      cutEntry(selectedEntry);
    } else if (mod && event.key.toLowerCase() === "v" && fsClipboard) {
      event.preventDefault();
      void pasteInto(activeDir);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selectedEntry) {
      event.preventDefault();
      void deleteEntry(selectedEntry);
    }
  };

  const openMenu = (event: React.MouseEvent, dir: string, entry: TreeEntry | null = null) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDir(dir);
    setMenu({ x: event.clientX, y: event.clientY, dir, entry });
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        { label: "New File", icon: <FilePlus size={14} />, onClick: () => startCreate(menu.dir, "file") },
        { label: "New Folder", icon: <FolderPlus size={14} />, onClick: () => startCreate(menu.dir, "dir") },
        ...(fsClipboard ? [{ label: "Paste", icon: <ClipboardPaste size={14} />, onClick: () => void pasteInto(menu.dir) }] : []),
        { label: "Refresh", icon: <RefreshCw size={13} />, onClick: () => void loadDir(menu.dir) },
        ...(menu.entry
          ? ([
              { label: "Rename", icon: <Pencil size={14} />, onClick: () => startRename(menu.entry!.path) },
              { label: "Copy", icon: <Copy size={14} />, onClick: () => copyEntry(menu.entry!) },
              { label: "Cut", icon: <Scissors size={14} />, onClick: () => cutEntry(menu.entry!) },
              { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteEntry(menu.entry!) }
            ] satisfies ContextMenuItem[])
          : [])
      ]
    : [];

  return (
    <div className="flex h-full min-h-0 bg-neutral-950">
      {/* Tree sub-sidebar (full width on mobile; hidden when a file is open) */}
      <div
        className={cn(
          "min-h-0 w-full flex-col bg-neutral-900/35 md:flex md:w-[var(--sidebar-width)] md:shrink-0",
          selectedFile ? "hidden md:flex" : "flex w-full"
        )}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
          <div
            role="tablist"
            aria-label="File tools"
            className="flex h-7 min-w-0 items-center gap-0.5 rounded-lg bg-neutral-900/70 p-0.5"
          >
            {SIDEBAR_TABS.map((tab) => {
              const selected = sidebarTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={tab.label}
                  onClick={() => setSidebarTab(tab.id)}
                  className={cn(
                    "flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                    selected ? "bg-neutral-700/80 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          {sidebarTab === "files" && <div className="flex shrink-0 items-center">
            <Dropdown
              align="right"
              width="w-44"
              trigger={
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200">
                  <MoreHorizontal size={15} />
                </span>
              }
            >
              <DropdownLabel>New</DropdownLabel>
              <DropdownItem icon={<FilePlus size={14} />} onClick={() => startCreate(activeDir, "file")}>
                New file
              </DropdownItem>
              <DropdownItem icon={<FolderPlus size={14} />} onClick={() => startCreate(activeDir, "dir")}>
                New folder
              </DropdownItem>
              {fsClipboard && (
                <DropdownItem icon={<ClipboardPaste size={14} />} onClick={() => void pasteInto(activeDir)}>
                  Paste
                </DropdownItem>
              )}
              <DropdownItem icon={<RefreshCw size={13} />} onClick={() => void loadDir(activeDir)}>
                Refresh
              </DropdownItem>
            </Dropdown>
          </div>}
        </div>

        {sidebarTab === "files" ? <div
          className="min-h-0 flex-1 overflow-auto px-1 py-1"
          onContextMenu={(e) => openMenu(e, rootPath)}
          onKeyDown={handleTreeKeyDown}
        >
          {creating && (
            <div className="px-2 py-1">
              <Input
                autoFocus
                placeholder={creating === "dir" ? "folder name" : "file name"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = e.currentTarget.value.trim();
                    if (value) void submitCreate(value);
                  } else if (e.key === "Escape") {
                    setCreating(null);
                  }
                }}
                onBlur={() => setCreating(null)}
              />
              <p className="px-1 pt-1 text-[10px] text-neutral-600">in {baseName(activeDir)}/</p>
            </div>
          )}
          {error && <p className="px-3 py-1 text-xs text-red-400">{error}</p>}
          <TreeLevel
            dir={rootPath}
            depth={0}
            childrenByPath={childrenByPath}
            expanded={expanded}
            selectedFile={selectedFile}
            activeDir={activeDir}
            renaming={renaming}
            onToggleDir={toggleDir}
            onSelectFile={selectFile}
            onContextMenu={openMenu}
            onRenameSubmit={submitRename}
            onRenameCancel={() => setRenaming(null)}
          />
        </div> : (
          <SearchPanel
            replaceMode={sidebarTab === "replace"}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            replacement={replaceWith}
            onReplacementChange={setReplaceWith}
            regex={searchRegex}
            onRegexChange={setSearchRegex}
            matches={matches}
            loading={searchLoading}
            error={searchError}
            changedCount={changedPreviews.length}
            onOpenMatch={openMatch}
            onOpenFileGroup={openReplacePreview}
          />
        )}
      </div>

      <div
        className="group relative hidden w-px shrink-0 md:flex"
        role="separator"
        aria-label="Resize file sidebar"
        aria-valuemin={220}
        aria-valuemax={440}
        aria-valuenow={sidebarWidth}
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize touch-none" onPointerDown={startResize} />
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-600/60" />
      </div>

      {/* Content pane (full width on mobile when a file is selected) */}
      <div
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedFile ? "flex" : "hidden md:flex"
        )}
      >
        <FileContent
          rootPath={rootPath}
          path={selectedFile}
          jumpLine={jumpLine}
          diff={diffPreview}
          refreshToken={refreshToken}
          changedFileCount={changedPreviews.length}
          onReplaceFile={() => diffPreview && void replaceFile(diffPreview.path)}
          onReplaceAll={() => void replaceAllMatches()}
          tabs={openFiles}
          onSelectTab={(path) => { setDiffPreview(null); setSelectedFile(path); setActiveDir(parentOf(path)); }}
          onCloseTab={closeFile}
          onBack={() => setSelectedFile(null)}
        />
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
};

interface TreeLevelProps {
  dir: string;
  depth: number;
  childrenByPath: Record<string, FsEntry[]>;
  expanded: Set<string>;
  selectedFile: string | null;
  activeDir: string;
  renaming: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, dir: string, entry?: TreeEntry | null) => void;
  onRenameSubmit: (path: string, name: string) => void;
  onRenameCancel: () => void;
}

const TreeLevel: React.FC<TreeLevelProps> = (props) => {
  const entries = props.childrenByPath[props.dir];
  if (!entries) {
    return props.depth === 0 ? (
      <p className="px-3 py-2 text-xs text-neutral-600">Loading…</p>
    ) : null;
  }
  if (entries.length === 0 && props.depth === 0) {
    return <p className="px-3 py-2 text-xs text-neutral-600">Empty directory</p>;
  }

  return (
    <>
      {entries.map((entry) => {
        const isDir = entry.kind === "dir";
        const isOpen = props.expanded.has(entry.path);
        const isActive = !isDir && entry.path === props.selectedFile;
        const isRenaming = props.renaming === entry.path;
        return (
          <React.Fragment key={entry.path}>
            {isRenaming ? (
              <div
                style={{ paddingLeft: 8 + props.depth * 12 }}
                className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 py-1 pr-2"
              >
                <span className="w-[13px]" />
                {isDir ? (
                  <Folder size={14} className="shrink-0 text-neutral-500" />
                ) : (
                  <FileTypeIcon name={entry.name} size={14} />
                )}
                <Input
                  autoFocus
                  defaultValue={entry.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      props.onRenameSubmit(entry.path, e.currentTarget.value);
                    } else if (e.key === "Escape") {
                      props.onRenameCancel();
                    }
                  }}
                  onBlur={() => props.onRenameCancel()}
                  className="h-7 flex-1 px-1.5 text-[13px]"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => (isDir ? props.onToggleDir(entry.path) : props.onSelectFile(entry.path))}
                onContextMenu={(e) =>
                  props.onContextMenu(e, isDir ? entry.path : parentOf(entry.path), {
                    path: entry.path,
                    kind: isDir ? "dir" : "file"
                  })
                }
                style={{ paddingLeft: 8 + props.depth * 12 }}
                className={cn(
                  "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-[13px] transition-colors",
                  isActive ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
                )}
              >
                {isDir ? (
                  <span className="text-neutral-500">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                ) : (
                  <span className="w-[13px]" />
                )}
                {isDir ? (
                  <Folder size={14} className="shrink-0 text-neutral-500" />
                ) : (
                  <FileTypeIcon name={entry.name} size={14} />
                )}
                <span className="flex-1 truncate">{entry.name}</span>
              </button>
            )}
            {isDir && isOpen && <TreeLevel {...props} dir={entry.path} depth={props.depth + 1} />}
          </React.Fragment>
        );
      })}
    </>
  );
};

interface SearchPanelProps {
  replaceMode: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  replacement: string;
  onReplacementChange: (value: string) => void;
  regex: boolean;
  onRegexChange: (value: boolean) => void;
  matches: FsSearchMatch[];
  loading: boolean;
  error: string | null;
  changedCount: number;
  onOpenMatch: (match: FsSearchMatch) => void;
  onOpenFileGroup: (path: string) => void;
}

/** Grouped-by-file summary of matches for replace mode: counts only, no inline diffs (open a file to preview and apply). */
const groupMatchesByFile = (matches: FsSearchMatch[]) => {
  const order: string[] = [];
  const byPath = new Map<string, FsSearchMatch[]>();
  for (const match of matches) {
    if (!byPath.has(match.path)) {
      order.push(match.path);
      byPath.set(match.path, []);
    }
    byPath.get(match.path)!.push(match);
  }
  return order.map((path) => ({ path, matches: byPath.get(path)! }));
};

const SearchPanel: React.FC<SearchPanelProps> = ({
  replaceMode,
  query,
  onQueryChange,
  replacement,
  onReplacementChange,
  regex,
  onRegexChange,
  matches,
  loading,
  error,
  changedCount,
  onOpenMatch,
  onOpenFileGroup
}) => {
  const groups = replaceMode ? groupMatchesByFile(matches) : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
      <div className="space-y-1.5">
        <div className="flex h-8 items-center gap-2 rounded-lg bg-neutral-900/70 px-2.5 text-neutral-500 transition-colors focus-within:bg-neutral-900 focus-within:text-neutral-300">
          <Search size={13} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search in files" className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600" />
          <label className="flex items-center gap-1 text-[10px] text-neutral-600"><input type="checkbox" checked={regex} onChange={(event) => onRegexChange(event.target.checked)} /> regex</label>
        </div>
        {replaceMode && <div className="flex h-8 items-center gap-2 rounded-lg bg-neutral-900/70 px-2.5 text-neutral-500 transition-colors focus-within:bg-neutral-900 focus-within:text-neutral-300">
          <Replace size={13} />
          <input value={replacement} onChange={(event) => onReplacementChange(event.target.value)} placeholder="Replace with" className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600" />
        </div>}
      </div>
      {loading && <div className="flex items-center gap-2 px-1 py-4 text-xs text-neutral-600"><LoaderCircle size={13} className="animate-spin" /> Searching…</div>}
      {error && <p className="px-1 py-2 text-[11px] text-amber-500">{error}</p>}
      {!loading && query && !matches.length && <p className="px-1 py-5 text-center text-xs text-neutral-600">No matches</p>}

      {replaceMode ? (
        <div className="mt-2 space-y-1">
          {changedCount > 0 && (
            <p className="px-1 pb-1 text-[10px] text-neutral-600">{changedCount} file{changedCount === 1 ? "" : "s"} would change — open one to preview and apply.</p>
          )}
          {groups.map((group) => (
            <button
              key={group.path}
              type="button"
              onClick={() => onOpenFileGroup(group.path)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-800/70"
            >
              <FileTypeIcon name={group.path} size={13} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-300">{baseName(group.path)}</span>
              <span className="shrink-0 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400">{group.matches.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          {matches.map((match, index) => (
            <button key={`${match.path}:${match.line}:${match.column}:${index}`} type="button" onClick={() => onOpenMatch(match)} className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-neutral-800/70">
              <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-300"><span className="truncate">{baseName(match.path)}</span><span className="shrink-0 text-[10px] text-neutral-600">{match.line}:{match.column}</span></div>
              <div className="truncate pt-1 font-mono text-[10px] text-neutral-600">{match.preview || " "}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const FileContent: React.FC<{
  rootPath: string;
  path: string | null;
  jumpLine: number | null;
  diff: DiffPreview | null;
  refreshToken: number;
  changedFileCount: number;
  onReplaceFile: () => void;
  onReplaceAll: () => void;
  tabs: string[];
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onBack: () => void;
}> = ({ rootPath, path, jumpLine, diff, refreshToken, changedFileCount, onReplaceFile, onReplaceAll, tabs, onSelectTab, onCloseTab, onBack }) => {
  const api = useApi();
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [truncated, setTruncated] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!path) {
      return;
    }
    let active = true;
    setState("loading");
    api
      .readFile(path)
      .then((res) => {
        if (!active) return;
        setContent(res.content);
        setOriginal(res.content);
        setTruncated(res.truncated);
        setState("idle");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [api, path, refreshToken]);

  if (!path) {
    return (
      <div className="flex flex-1 items-center justify-center bg-neutral-950 px-6">
        <div className="max-w-xs text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-neutral-600">
            <File size={21} />
          </span>
          <p className="mt-4 text-sm font-medium text-neutral-300">Select a file</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">Choose a file from the project to preview and edit it here.</p>
        </div>
      </div>
    );
  }

  // Don't allow editing partial reads or binary blobs (would corrupt on save).
  const readOnly = truncated || content.includes("\u0000");
  const dirty = !readOnly && content !== original;

  const save = async () => {
    if (!dirty || saving) {
      return;
    }
    setSaving(true);
    try {
      await api.saveFile(path, content);
      setOriginal(content);
    } catch {
      /* surfaced as still-dirty */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex h-11 min-w-0 shrink-0 items-stretch gap-1 bg-neutral-900/50 px-2 pt-1.5">
        <button
          type="button"
          aria-label="Back to files"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 md:hidden"
        >
          <ArrowLeft size={15} />
        </button>
        <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab === path;
            const label = relativeToWorkspace(tab, rootPath);
            return (
              <div
                key={tab}
                role="tab"
                aria-selected={active}
                onClick={() => onSelectTab(tab)}
                onMouseDown={(event) => {
                  if (event.button === 1) event.preventDefault();
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onCloseTab(tab);
                  }
                }}
                className={cn(
                  "group flex min-w-0 max-w-52 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg px-3 text-[12px] transition-colors",
                  active
                    ? "bg-neutral-950 text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                )}
              >
                <FileTypeIcon name={tab} size={13} className={active ? "" : "opacity-70"} />
                <span title={label} className="min-w-0 flex-1 truncate">{label}</span>
                {active && dirty ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" title="Unsaved changes" />
                ) : null}
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-neutral-500 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-100 group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
        {truncated && <span className="hidden shrink-0 self-center px-2 text-[10px] text-neutral-600 lg:inline">read-only</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {state === "loading" && <p className="p-3 text-xs text-neutral-600">Loading…</p>}
        {state === "error" && <p className="p-3 text-xs text-red-400">Could not read file.</p>}
        {state === "idle" && diff && (
          <DiffViewer preview={diff} changedFileCount={changedFileCount} onReplaceFile={onReplaceFile} onReplaceAll={onReplaceAll} />
        )}
        {state === "idle" && !diff && (
          <Editor
            filename={baseName(path)}
            value={content}
            line={jumpLine}
            readOnly={readOnly}
            onChange={setContent}
            onSave={() => void save()}
          />
        )}
      </div>
    </>
  );
};

const DiffViewer: React.FC<{
  preview: DiffPreview;
  changedFileCount: number;
  onReplaceFile: () => void;
  onReplaceAll: () => void;
}> = ({ preview, changedFileCount, onReplaceFile, onReplaceAll }) => {
  const before = preview.before.split(/\r?\n/);
  const after = preview.after.split(/\r?\n/);
  const count = Math.max(before.length, after.length);
  const changed = preview.before !== preview.after;
  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-5">
        <div className="flex min-w-0 items-center gap-2">
          <FileTypeIcon name={preview.path} size={15} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-neutral-200">{baseName(preview.path)}</p>
            <p className="text-[11px] text-neutral-600">{preview.matchCount} match{preview.matchCount === 1 ? "" : "es"} in this file</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" disabled={!changed} onClick={onReplaceFile}>Replace this file</Button>
          <Button size="sm" variant="outline" disabled={changedFileCount === 0} onClick={onReplaceAll}>Replace all ({changedFileCount})</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 font-mono text-[12px] leading-6">
        {Array.from({ length: count }, (_, index) => {
          const oldLine = before[index];
          const newLine = after[index];
          if (oldLine === newLine) {
            return (
              <div key={index} className="flex gap-3 whitespace-pre-wrap break-words px-2 text-neutral-500">
                <span className="w-7 shrink-0 select-none text-right text-neutral-700">{index + 1}</span>
                <span className="min-w-0 flex-1">{oldLine}</span>
              </div>
            );
          }
          return (
            <React.Fragment key={index}>
              {oldLine !== undefined && (
                <div className="flex gap-3 whitespace-pre-wrap break-words rounded-md bg-red-500/[0.07] px-2 text-red-300/90">
                  <span className="w-7 shrink-0 select-none text-right text-red-800">−</span>
                  <span className="min-w-0 flex-1">{oldLine}</span>
                </div>
              )}
              {newLine !== undefined && (
                <div className="flex gap-3 whitespace-pre-wrap break-words rounded-md bg-emerald-500/[0.07] px-2 text-emerald-300/90">
                  <span className="w-7 shrink-0 select-none text-right text-emerald-700">+</span>
                  <span className="min-w-0 flex-1">{newLine}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
