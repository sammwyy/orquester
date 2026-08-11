import React, { useEffect, useState } from "react";
import { AppWindow, Boxes, ChevronLeft, ChevronRight, Download, Loader2, Palette, RefreshCw, Server } from "lucide-react";
import type { DaemonConfig } from "@orquester/config";
import type { BlurStrategy } from "../../types";
import { cn } from "../../lib/cn";
import { Button, Input, Modal, ModalCloseButton, Switch } from "../ui";
import { getRegistryIcon } from "../../icons";
import { useIsDesktop, useRegistry } from "../../hooks";
import { useApi, useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

type Section = "app" | "appearance" | "daemon" | "agents";
/** Client settings live in this window; server settings belong to the daemon. */
type Group = "client" | "server";

const GROUPS: { id: Group; label: string }[] = [
  { id: "client", label: "Client" },
  { id: "server", label: "Server" }
];

const SECTIONS: {
  id: Section;
  group: Group;
  label: string;
  icon: React.ReactNode;
  desc: string;
}[] = [
  {
    id: "app",
    group: "client",
    label: "App",
    icon: <AppWindow size={16} />,
    desc: "Window behaviour, runtime, active server"
  },
  {
    id: "appearance",
    group: "client",
    label: "Appearance",
    icon: <Palette size={16} />,
    desc: "Titlebar and sidebar look"
  },
  {
    id: "daemon",
    group: "server",
    label: "Daemon",
    icon: <Server size={16} />,
    desc: "Workspaces dir, external HTTP access"
  },
  {
    id: "agents",
    group: "server",
    label: "Agents",
    icon: <Boxes size={16} />,
    desc: "Install, update and view harness versions"
  }
];

const sectionsOf = (group: Group) => SECTIONS.filter((s) => s.group === group);

const renderSection = (id: Section) =>
  id === "app" ? (
    <AppSettings />
  ) : id === "appearance" ? (
    <AppearanceSettings />
  ) : id === "daemon" ? (
    <DaemonSettings />
  ) : (
    <AgentsSettings />
  );
const labelOf = (id: Section) => SECTIONS.find((s) => s.id === id)?.label ?? "";

export const SettingsModal: React.FC = () => {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const isDesktop = useIsDesktop();
  const [section, setSection] = useState<Section | null>(null);

  // Reset to the category list each time it closes (mobile shows list first).
  useEffect(() => {
    if (!open) {
      setSection(null);
    }
  }, [open]);

  const close = () => setOpen(false);

  // --- Desktop: persistent side nav + content ---
  if (isDesktop) {
    const current = section ?? "app";
    return (
      <Modal open={open} onClose={close} className="h-[85vh] max-w-4xl">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-neutral-800 bg-neutral-950/40 p-2">
          {GROUPS.map((group) => (
            <React.Fragment key={group.id}>
              <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-neutral-500 first:pt-1">
                {group.label}
              </p>
              {sectionsOf(group.id).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    current === s.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/60"
                  )}
                >
                  <span className="text-neutral-500">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
            <span className="text-sm font-medium text-neutral-100">{labelOf(current)}</span>
            <ModalCloseButton onClose={close} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{renderSection(current)}</div>
        </div>
      </Modal>
    );
  }

  // --- Mobile: category list → detail with a back button ---
  return (
    <Modal open={open} onClose={close} className="h-[88vh]">
      <div className="flex w-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
          {section ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => setSection(null)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800"
            >
              <ChevronLeft size={18} />
            </button>
          ) : (
            <span className="px-2" />
          )}
          <span className="flex-1 text-sm font-medium text-neutral-100">
            {section ? labelOf(section) : "Settings"}
          </span>
          <ModalCloseButton onClose={close} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === null ? (
            <div className="p-2">
              {GROUPS.map((group) => (
                <div key={group.id} className="mb-2 last:mb-0">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                    {group.label}
                  </p>
                  {sectionsOf(group.id).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSection(s.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-neutral-800/60"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-800 text-neutral-300">
                        {s.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-neutral-100">{s.label}</span>
                        <span className="block truncate text-xs text-neutral-500">{s.desc}</span>
                      </span>
                      <ChevronRight size={16} className="text-neutral-600" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">{renderSection(section)}</div>
          )}
        </div>
      </div>
    </Modal>
  );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0">
      <p className="text-sm text-neutral-200">{label}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

type AgentFilter = "all" | "installed" | "available";

const AgentsSettings: React.FC = () => {
  const registry = useRegistry();
  const installAgent = useAppStore((s) => s.installAgent);
  const updateAgent = useAppStore((s) => s.updateAgent);
  const [filter, setFilter] = useState<AgentFilter>("all");

  const agents = registry.agents.filter((a) =>
    filter === "installed" ? a.enabled : filter === "available" ? !a.enabled : true
  );

  const filters: { id: AgentFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "installed", label: "Installed" },
    { id: "available", label: "Available" }
  ];

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg bg-neutral-800/60 p-0.5 text-xs">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-md px-3 py-1 transition-colors",
              filter === f.id ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {agents.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-600">No agents in this view.</p>
        )}
        {agents.map((agent) => {
          const busy = agent.installState === "installing";
          const failed = agent.installState === "error";
          return (
            <div key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400">
                {getRegistryIcon("agent", agent.id, 18)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-100">{agent.name}</p>
                <p className="truncate text-xs text-neutral-500">
                  {busy
                    ? agent.enabled
                      ? "Updating…"
                      : "Installing…"
                    : failed
                      ? `Failed${agent.installError ? `: ${firstLine(agent.installError)}` : ""}`
                      : agent.enabled
                        ? agent.version ?? "installed"
                        : "Not installed"}
                </p>
              </div>
              <div className="shrink-0">
                {busy ? (
                  <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                    <Loader2 size={13} className="animate-spin" />
                    {agent.enabled ? "Updating…" : "Installing…"}
                  </span>
                ) : failed ? (
                  <Button size="sm" variant="outline" onClick={() => void installAgent(agent.id)}>
                    <RefreshCw size={13} /> Retry
                  </Button>
                ) : agent.enabled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!agent.updateCmd}
                    onClick={() => void updateAgent(agent.id)}
                  >
                    <RefreshCw size={13} /> Update
                  </Button>
                ) : (
                  <Button size="sm" disabled={!agent.installCmd} onClick={() => void installAgent(agent.id)}>
                    <Download size={13} /> Install
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "";

const AppSettings: React.FC = () => {
  const { runtime } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const active = connections.find((c) => c.id === activeId);

  return (
    <div className="divide-y divide-neutral-800">
      {runtime === "desktop" && (
        <Field
          label="Run in background"
          hint="Closing the window keeps the daemon running in the tray."
        >
          <Switch
            checked={appConfig.runInBackground}
            onChange={(checked) => void updateAppConfig({ runInBackground: checked })}
          />
        </Field>
      )}
      <Field label="Runtime">
        <span className="text-sm text-neutral-400">{runtime}</span>
      </Field>
      <Field label="Active server">
        <span className="text-sm text-neutral-400">{active?.name ?? "—"}</span>
      </Field>
    </div>
  );
};

const BLUR_HINT: Record<BlurStrategy, string> = {
  vibrancy: "Translucent sidebar, blurred by macOS vibrancy.",
  acrylic: "Translucent sidebar, blurred by Windows acrylic.",
  kwin: "Translucent sidebar, blurred by KWin."
};

const AppearanceSettings: React.FC = () => {
  const { runtime } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const blurStrategy = useAppStore((s) => s.blurStrategy);

  return (
    <div className="divide-y divide-neutral-800">
      <Field label="Custom titlebar" hint="Frameless window with in-app window controls.">
        <Switch
          checked={appConfig.useTitlebar}
          onChange={(checked) => void updateAppConfig({ useTitlebar: checked })}
        />
      </Field>
      {runtime === "desktop" && (
        <Field
          label="Glass sidebar"
          hint={
            blurStrategy
              ? BLUR_HINT[blurStrategy]
              : "No window blur on this system — needs macOS, Windows 11 or KDE/KWin."
          }
        >
          <Switch
            checked={appConfig.glassSidebar && blurStrategy !== null}
            disabled={blurStrategy === null}
            onChange={(checked) => void updateAppConfig({ glassSidebar: checked })}
          />
        </Field>
      )}
    </div>
  );
};

const DaemonSettings: React.FC = () => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";

  const [workspacesDir, setWorkspacesDir] = useState("");
  const [httpEnabled, setHttpEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setWorkspacesDir(config.workspacesDir);
        setHttpEnabled(config.transports.http.enabled);
        setHost(config.transports.http.host);
        setPort(String(config.transports.http.port));
      })
      .catch(() => setMessage("Could not load daemon config."));
    return () => {
      active = false;
    };
  }, [api]);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.updateDaemonConfig({
        workspacesDir,
        transports: {
          http: {
            enabled: httpEnabled,
            host,
            port: Number(port) || 47831,
            ...(password ? { password } : {})
          }
        }
      });
      setPassword("");
      setMessage("Saved. Transport changes apply after a daemon restart.");
    } catch {
      setMessage("Failed to save (daemon config is editable only over the local socket).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!isLocal && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
          Daemon settings can only be changed from the local app (unix socket). Connected over HTTP
          they are read-only.
        </div>
      )}

      <div className="divide-y divide-neutral-800">
        <Field label="Workspaces directory" hint="Supports $userhome / $appdir variables.">
          <Input
            className="w-40 sm:w-64"
            value={workspacesDir}
            disabled={!isLocal}
            onChange={(e) => setWorkspacesDir(e.target.value)}
          />
        </Field>

        <Field label="External HTTP access" hint="Expose the daemon to remote clients (token-gated).">
          <Switch checked={httpEnabled} disabled={!isLocal} onChange={setHttpEnabled} />
        </Field>

        {httpEnabled && (
          <>
            <Field label="Host">
              <Input
                className="w-40 sm:w-64"
                value={host}
                disabled={!isLocal}
                onChange={(e) => setHost(e.target.value)}
              />
            </Field>
            <Field label="Port">
              <Input
                className="w-40 sm:w-64"
                value={port}
                disabled={!isLocal}
                onChange={(e) => setPort(e.target.value)}
              />
            </Field>
            <Field label="Password" hint="Min 8 chars. Leave blank to keep current.">
              <Input
                className="w-40 sm:w-64"
                type="password"
                placeholder="••••••••"
                value={password}
                disabled={!isLocal}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>

      {message && <p className="text-xs text-neutral-400">{message}</p>}

      {isLocal && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save daemon config"}
        </Button>
      )}
    </div>
  );
};
