import React, { useEffect, useRef, useState } from "react";
import { Globe, LoaderCircle, Plus, RefreshCw, Send, X } from "lucide-react";
import type { HttpExecuteResponse, HttpFileParsed, HttpHeader, HttpRequestDef } from "@orquester/api";
import { cn } from "../../lib/cn";
import { Button, Input, Modal, ModalCloseButton, SegmentedControl } from "../ui";
import { Editor } from "../files/Editor";
import { useApi } from "../../context/orquester-context";

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const ENV_PREFIX = "env_";

/** Substitutes `{{name}}` from `variables`; names in `skip` (resolved worker-side) are left untouched. */
const interpolate = (text: string, variables: Record<string, string>, skip: ReadonlySet<string> = new Set()) =>
  text.replace(VARIABLE_RE, (match, name: string) => (skip.has(name) ? match : (variables[name] ?? match)));

/** Every distinct `{{name}}` referenced across a request's url/headers/body. */
const referencedVariables = (edit: { url: string; headers: HttpHeader[]; body: string }): string[] => {
  const names = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(VARIABLE_RE)) names.add(match[1]);
  };
  scan(edit.url);
  for (const header of edit.headers) {
    scan(header.key);
    scan(header.value);
  }
  scan(edit.body);
  return [...names];
};

const baseName = (p: string) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
const relativeTo = (path: string, rootPath: string) => {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPath === normalizedRoot) return "";
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : baseName(path);
};

const METHOD_COLOR: Record<string, string> = {
  GET: "text-sky-400",
  POST: "text-emerald-400",
  PUT: "text-amber-400",
  PATCH: "text-fuchsia-400",
  DELETE: "text-red-400"
};
const methodColor = (method: string) => METHOD_COLOR[method.toUpperCase()] ?? "text-neutral-400";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const statusColor = (status: number) => {
  if (status === 0) return "text-red-400";
  if (status < 300) return "text-emerald-400";
  if (status < 400) return "text-sky-400";
  if (status < 500) return "text-amber-400";
  return "text-red-400";
};

interface EditableRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
}

const toEditable = (def: HttpRequestDef): EditableRequest => ({
  method: def.method,
  url: def.url,
  headers: def.headers.map((h) => ({ ...h })),
  body: def.body ?? ""
});

const keyOf = (filePath: string, index: number) => `${filePath}::${index}`;

const contentTypeFilename = (headers: HttpHeader[]) => {
  const contentType = headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
  if (contentType.includes("json")) return "body.json";
  if (contentType.includes("xml")) return "body.xml";
  if (contentType.includes("html")) return "body.html";
  return "body.txt";
};

/** Servers commonly send minified JSON; format it for readability, falling back to the raw body if it doesn't parse. */
const prettyBody = (body: string, headers: HttpHeader[]) => {
  if (!headers.some((h) => h.key.toLowerCase() === "content-type" && h.value.includes("json"))) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

/**
 * Rest Client tool: a sidebar of every request parsed out of the project's
 * `.http`/`.rest` files, and a right pane to edit/send the selected one.
 * Execution happens on the worker (see api.executeHttpRequest) so it runs
 * with the daemon's own network position, not the browser's. Any `{{name}}`
 * not defined by an `@name = value` in the file resolves from this
 * project's worker-side variable store, or — for `{{env_NAME}}` — straight
 * from the project's own `.env`; either way the value never reaches this
 * client, only whether one is configured.
 */
export const RestClient: React.FC<{ rootPath: string }> = ({ rootPath }) => {
  const api = useApi();
  const [files, setFiles] = useState<HttpFileParsed[]>([]);
  const [variableNames, setVariableNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ filePath: string; index: number } | null>(null);
  const [edits, setEdits] = useState<Record<string, EditableRequest>>({});
  const [variablesByFile, setVariablesByFile] = useState<Record<string, Record<string, string>>>({});
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<HttpExecuteResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const resizing = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listHttpFiles(rootPath);
      setFiles(result.files);
      setVariablesByFile((prev) => {
        const next = { ...prev };
        for (const file of result.files) next[file.path] = { ...file.variables, ...next[file.path] };
        return next;
      });
      return result.files;
    } catch {
      setError("Could not read .http/.rest files in this project.");
      return [];
    } finally {
      setLoading(false);
    }
  };

  const loadVariableNames = () => {
    api
      .listHttpVariables(rootPath)
      .then((result) => setVariableNames(new Set(result.names)))
      .catch(() => undefined);
  };

  useEffect(() => {
    void load();
    loadVariableNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, rootPath]);

  const selectedFile = selected ? files.find((f) => f.path === selected.filePath) : undefined;
  const selectedDef = selectedFile && selected ? selectedFile.requests[selected.index] : undefined;
  const editKey = selected ? keyOf(selected.filePath, selected.index) : null;
  const edit = editKey ? (edits[editKey] ?? (selectedDef ? toEditable(selectedDef) : undefined)) : undefined;
  const variables = selected ? (variablesByFile[selected.filePath] ?? {}) : {};

  // Derived from the live edit, not just the on-disk parse — otherwise a
  // {{var}} typed into a header just now wouldn't show up until saved.
  const referenced = edit ? referencedVariables(edit) : [];
  const envVars = referenced.filter((name) => !(name in variables) && name.startsWith(ENV_PREFIX));
  const storeVars = referenced.filter((name) => !(name in variables) && !name.startsWith(ENV_PREFIX));

  const select = (filePath: string, index: number) => {
    setSelected({ filePath, index });
    setResponse(null);
    setSendError(null);
  };

  const updateEdit = (patch: Partial<EditableRequest>) => {
    if (!editKey || !edit) return;
    setEdits((prev) => ({ ...prev, [editKey]: { ...edit, ...patch } }));
  };

  const updateVariable = (name: string, value: string) => {
    if (!selected) return;
    setVariablesByFile((prev) => ({ ...prev, [selected.filePath]: { ...prev[selected.filePath], [name]: value } }));
  };

  const setStoredVariable = async (name: string, value: string) => {
    await api.setHttpVariable({ path: rootPath, name, value });
    setVariableNames((prev) => new Set(prev).add(name));
  };

  const clearStoredVariable = async (name: string) => {
    await api.deleteHttpVariable({ path: rootPath, name });
    setVariableNames((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const send = async () => {
    if (!edit) return;
    setSending(true);
    setSendError(null);
    setResponse(null);
    const skip = new Set([...storeVars, ...envVars]);
    try {
      const result = await api.executeHttpRequest({
        method: edit.method,
        url: interpolate(edit.url, variables, skip),
        headers: edit.headers
          .filter((h) => h.key.trim())
          .map((h) => ({ key: interpolate(h.key, variables, skip), value: interpolate(h.value, variables, skip) })),
        body: edit.body.trim() ? interpolate(edit.body, variables, skip) : undefined,
        projectPath: rootPath
      });
      setResponse(result);
    } catch {
      setSendError("Could not reach the daemon.");
    } finally {
      setSending(false);
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (moveEvent: PointerEvent) => {
      if (!resizing.current) return;
      setSidebarWidth(Math.min(440, Math.max(220, startWidth + moveEvent.clientX - startX)));
    };
    const end = () => {
      resizing.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const handleCreated = async (filePath: string, requestName: string) => {
    const nextFiles = await load();
    const file = nextFiles.find((f) => f.path === filePath);
    const index = file?.requests.findIndex((r) => r.name === requestName) ?? -1;
    if (file && index >= 0) select(file.path, index);
  };

  // New requests default into whichever folder already has .http files, so
  // a project settles on one place instead of scattering a folder per click.
  const defaultFolder = files.length > 0 ? relativeTo(dirName(files[0].path), rootPath) : "http";

  return (
    <div className="flex h-full min-h-0 bg-neutral-950">
      <div
        className={cn(
          "min-h-0 w-full flex-col bg-neutral-900/35 md:flex md:w-[var(--sidebar-width)] md:shrink-0",
          selected ? "hidden md:flex" : "flex w-full"
        )}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">Requests</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="New request"
              title="New request"
              onClick={() => setNewRequestOpen(true)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              aria-label="Refresh"
              onClick={() => void load()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
          {loading && <p className="px-3 py-2 text-xs text-neutral-600">Loading…</p>}
          {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
          {!loading && !error && files.length === 0 && (
            <div className="px-3 py-4 text-center">
              <p className="text-xs text-neutral-600">No .http or .rest files in this project.</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setNewRequestOpen(true)}>
                <Plus size={13} /> New request
              </Button>
            </div>
          )}
          {files.map((file) => (
            <div key={file.path} className="mb-2 last:mb-0">
              <p title={file.path} className="truncate px-2.5 py-1 text-[10px] font-medium text-neutral-600">
                {relativeTo(file.path, rootPath) || file.name}
              </p>
              {file.requests.length === 0 ? (
                <p className="px-3 py-1 text-[11px] text-neutral-700">No requests found</p>
              ) : (
                file.requests.map((request, index) => {
                  const active = selected?.filePath === file.path && selected.index === index;
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => select(file.path, index)}
                      className={cn(
                        "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                        active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
                      )}
                    >
                      <span className={cn("w-11 shrink-0 text-[10px] font-semibold", methodColor(request.method))}>
                        {request.method}
                      </span>
                      <span className="flex-1 truncate">{request.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="group relative hidden w-px shrink-0 md:flex"
        role="separator"
        aria-label="Resize request sidebar"
        aria-valuemin={220}
        aria-valuemax={440}
        aria-valuenow={sidebarWidth}
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize touch-none" onPointerDown={startResize} />
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-neutral-600/60" />
      </div>

      <div className={cn("min-w-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
        {!selected || !edit ? (
          <div className="flex flex-1 items-center justify-center bg-neutral-950 px-6">
            <div className="max-w-xs text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-neutral-600">
                <Globe size={21} />
              </span>
              <p className="mt-4 text-sm font-medium text-neutral-300">Select a request</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                Pick a request from a .http or .rest file to view, edit and send it.
              </p>
            </div>
          </div>
        ) : (
          <RequestDetail
            edit={edit}
            variables={variables}
            storeVars={storeVars}
            envVars={envVars}
            variableNames={variableNames}
            sending={sending}
            response={response}
            sendError={sendError}
            onChange={updateEdit}
            onVariableChange={updateVariable}
            onSetVariable={setStoredVariable}
            onClearVariable={(name) => void clearStoredVariable(name)}
            onSend={() => void send()}
          />
        )}
      </div>

      <NewRequestModal
        open={newRequestOpen}
        onClose={() => setNewRequestOpen(false)}
        rootPath={rootPath}
        defaultFolder={defaultFolder}
        onCreated={(filePath, name) => void handleCreated(filePath, name)}
      />
    </div>
  );
};

type RequestTab = "headers" | "body" | "variables";
type ResponseTab = "body" | "headers";

const RequestDetail: React.FC<{
  edit: EditableRequest;
  variables: Record<string, string>;
  storeVars: string[];
  envVars: string[];
  variableNames: Set<string>;
  sending: boolean;
  response: HttpExecuteResponse | null;
  sendError: string | null;
  onChange: (patch: Partial<EditableRequest>) => void;
  onVariableChange: (name: string, value: string) => void;
  onSetVariable: (name: string, value: string) => Promise<void>;
  onClearVariable: (name: string) => void;
  onSend: () => void;
}> = ({ edit, variables, storeVars, envVars, variableNames, sending, response, sendError, onChange, onVariableChange, onSetVariable, onClearVariable, onSend }) => {
  const [tab, setTab] = useState<RequestTab>("headers");
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");

  const setHeader = (index: number, patch: Partial<HttpHeader>) => {
    const headers = edit.headers.map((h, i) => (i === index ? { ...h, ...patch } : h));
    onChange({ headers });
  };
  const addHeader = () => onChange({ headers: [...edit.headers, { key: "", value: "" }] });
  const removeHeader = (index: number) => onChange({ headers: edit.headers.filter((_, i) => i !== index) });

  const variableCount = Object.keys(variables).length + storeVars.length + envVars.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <select
          value={edit.method}
          onChange={(event) => onChange({ method: event.target.value })}
          className={cn(
            "h-8 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs font-semibold outline-none",
            methodColor(edit.method)
          )}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <Input
          value={edit.url}
          onChange={(event) => onChange({ url: event.target.value })}
          placeholder="https://example.com/path"
          className="flex-1 font-mono text-[12.5px]"
        />
        <Button size="sm" onClick={onSend} disabled={sending || !edit.url.trim()}>
          {sending ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}
          Send
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { id: "headers", label: `Headers${edit.headers.length ? ` (${edit.headers.length})` : ""}` },
            { id: "body", label: "Body" },
            { id: "variables", label: `Variables${variableCount ? ` (${variableCount})` : ""}` }
          ]}
        />
      </div>

      <div className="min-h-[160px] shrink-0 overflow-auto px-4 py-3" style={{ maxHeight: "38vh" }}>
        {tab === "headers" && (
          <div className="space-y-1.5">
            {edit.headers.map((header, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  value={header.key}
                  onChange={(event) => setHeader(index, { key: event.target.value })}
                  placeholder="Header"
                  className="h-7 flex-1 font-mono text-[12px]"
                />
                <Input
                  value={header.value}
                  onChange={(event) => setHeader(index, { value: event.target.value })}
                  placeholder="Value"
                  className="h-7 flex-[1.4] font-mono text-[12px]"
                />
                <button
                  type="button"
                  aria-label="Remove header"
                  onClick={() => removeHeader(index)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addHeader}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              <Plus size={12} /> Add header
            </button>
          </div>
        )}

        {tab === "body" && (
          <div className="h-40 overflow-hidden rounded-lg border border-neutral-800">
            <Editor filename={contentTypeFilename(edit.headers)} value={edit.body} onChange={(value) => onChange({ body: value })} />
          </div>
        )}

        {tab === "variables" && (
          <div className="space-y-1.5">
            {variableCount === 0 && <p className="px-1 py-2 text-[11px] text-neutral-600">This request doesn't reference any {"{{variables}}"}.</p>}
            {Object.entries(variables).map(([name, value]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span className="w-28 shrink-0 truncate font-mono text-[12px] text-neutral-400">{name}</span>
                <Input value={value} onChange={(event) => onVariableChange(name, event.target.value)} className="h-7 flex-1 font-mono text-[12px]" />
              </div>
            ))}
            {storeVars.map((name) => (
              <StoredVarRow
                key={name}
                name={name}
                configured={variableNames.has(name)}
                onSet={(value) => onSetVariable(name, value)}
                onClear={() => onClearVariable(name)}
              />
            ))}
            {envVars.map((name) => (
              <EnvVarRow key={name} name={name} />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 border-t border-neutral-900">
        {sendError && <p className="px-4 py-3 text-xs text-red-400">{sendError}</p>}
        {!response && !sendError && !sending && (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-neutral-600">
            Send the request to see its response here.
          </div>
        )}
        {sending && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-neutral-500">
            <LoaderCircle size={14} className="animate-spin" /> Sending…
          </div>
        )}
        {response && !sending && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-3 px-4 py-2.5">
              <span className={cn("text-sm font-semibold", statusColor(response.status))}>
                {response.status || "—"} {response.statusText}
              </span>
              <span className="text-[11px] text-neutral-600">{response.durationMs}ms</span>
              <span className="text-[11px] text-neutral-600">{(response.sizeBytes / 1024).toFixed(1)} KB</span>
              {response.truncated && <span className="text-[11px] text-amber-500">truncated</span>}
              <div className="ml-auto">
                <SegmentedControl
                  value={responseTab}
                  onChange={setResponseTab}
                  options={[
                    { id: "body", label: "Body" },
                    { id: "headers", label: `Headers (${response.headers.length})` }
                  ]}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {responseTab === "body" ? (
                <Editor
                  filename={contentTypeFilename(response.headers)}
                  value={prettyBody(response.body, response.headers)}
                  readOnly
                  onChange={() => {}}
                />
              ) : (
                <div className="h-full overflow-auto px-4 py-2">
                  {response.headers.map((header, index) => (
                    <div key={index} className="flex gap-2 py-1 text-[12px]">
                      <span className="w-40 shrink-0 truncate text-neutral-500">{header.key}</span>
                      <span className="min-w-0 flex-1 break-all text-neutral-300">{header.value}</span>
                    </div>
                  ))}
                  {response.headers.length === 0 && <p className="py-2 text-[11px] text-neutral-600">No headers.</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** A variable resolved from this project's worker-side store: write-only — its value never round-trips back to this client, only whether one is configured. */
const StoredVarRow: React.FC<{
  name: string;
  configured: boolean;
  onSet: (value: string) => Promise<void>;
  onClear: () => void;
}> = ({ name, configured, onSet, onClear }) => {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await onSet(value);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-28 shrink-0 truncate font-mono text-[12px] text-neutral-400">{name}</span>
      <Input
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={configured ? "configured — set to replace" : "not set"}
        className="h-7 flex-1 font-mono text-[12px]"
      />
      <Button size="sm" variant="outline" disabled={!value || busy} onClick={() => void save()}>
        Set
      </Button>
      {configured && (
        <button
          type="button"
          aria-label="Clear variable"
          onClick={onClear}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};

/** A {{env_NAME}} reference: informational only — resolved straight from the project's own .env at send time, nothing to configure here. */
const EnvVarRow: React.FC<{ name: string }> = ({ name }) => (
  <div className="flex items-center gap-1.5">
    <span className="w-28 shrink-0 truncate font-mono text-[12px] text-neutral-400">{name}</span>
    <span className="flex h-7 flex-1 items-center rounded-lg border border-dashed border-neutral-800 px-2.5 font-mono text-[11px] text-neutral-600">
      from .env → {name.slice(ENV_PREFIX.length) || name}
    </span>
  </div>
);

const NewRequestModal: React.FC<{
  open: boolean;
  onClose: () => void;
  rootPath: string;
  defaultFolder: string;
  onCreated: (filePath: string, requestName: string) => void;
}> = ({ open, onClose, rootPath, defaultFolder, onCreated }) => {
  const api = useApi();
  const [folder, setFolder] = useState(defaultFolder);
  const [file, setFile] = useState("requests.http");
  const [name, setName] = useState("New Request");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFolder(defaultFolder);
    setError(null);
  }, [open, defaultFolder]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmedFolder = folder.trim().replace(/^\/+|\/+$/g, "");
      const folderPath = trimmedFolder ? `${rootPath.replace(/\/$/, "")}/${trimmedFolder}` : rootPath;
      await api.createFsEntry(folderPath, "dir").catch(() => undefined);

      const fileName = file.trim() || "requests.http";
      const filePath = `${folderPath}/${fileName}`;
      const requestName = name.trim() || "New Request";
      const block = `### ${requestName}\n\n${method} ${url.trim() || "https://"}\n`;

      const existing = await api
        .readFile(filePath)
        .then((res) => res.content)
        .catch(() => null);
      if (existing === null) {
        await api.createFsEntry(filePath, "file").catch(() => undefined);
        await api.saveFile(filePath, block);
      } else {
        const trimmed = existing.replace(/\s+$/, "");
        await api.saveFile(filePath, trimmed ? `${trimmed}\n\n${block}` : block);
      }

      onCreated(filePath, requestName);
      onClose();
    } catch {
      setError("Could not create the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="h-fit w-full max-w-md flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800/70 px-4">
        <span className="text-sm font-medium text-neutral-100">New Request</span>
        <ModalCloseButton onClose={onClose} />
      </div>
      <div className="space-y-3 p-4">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <label className="block">
          <span className="text-[11px] text-neutral-500">Folder</span>
          <Input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="http" className="mt-1" />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">File</span>
          <Input value={file} onChange={(event) => setFile(event.target.value)} placeholder="requests.http" className="mt-1" />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Request name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" />
        </label>
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            className="h-8 shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 text-xs"
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" className="flex-1 font-mono text-[12px]" />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-neutral-900 p-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy && <LoaderCircle size={13} className="animate-spin" />}
          Create
        </Button>
      </div>
    </Modal>
  );
};
