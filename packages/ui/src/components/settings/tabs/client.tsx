import React, { useEffect, useState } from "react";
import { Globe2, Laptop, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { cn } from "../../../lib/cn";
import { Button, Input, Switch } from "../../ui";
import { useOrquester } from "../../../context/orquester-context";
import { useAppStore } from "../../../store/app";
import { Group, Field } from "./shared";
export const AppSettings: React.FC = () => {
  const { runtime, workerManager, api } = useOrquester();
  const appConfig = useAppStore((s) => s.appConfig);
  const updateAppConfig = useAppStore((s) => s.updateAppConfig);
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const active = connections.find((c) => c.id === activeId);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [workerState, setWorkerState] = useState<{ running: boolean; service: boolean } | null>(null);
  const remoteWorker = active?.kind === "remote";

  useEffect(() => {
    if (!workerManager) return;
    void Promise.all([workerManager.status(), workerManager.serviceStatus()]).then(([worker, service]) => {
      setWorkerState({ running: worker.running, service: service.installed });
    }).catch(() => setWorkerState(null));
  }, [workerManager]);

  useEffect(() => {
    if (!remoteWorker) {
      setWorkerState(null);
      return;
    }
    void api.workerServiceAction("status").then(({ output }) => {
      setWorkerState({ running: /running=true/i.test(output), service: /installed=true/i.test(output) });
    }).catch(() => setWorkerState(null));
  }, [api, remoteWorker]);

  const remoteAction = async (action: "install" | "uninstall" | "start" | "stop" | "restart") => {
    if (action === "restart" && !workerState?.service) {
      await api.restartWorker();
    } else if (action === "stop" && !workerState?.service) {
      await api.stopWorker();
    } else {
      await api.workerServiceAction(action);
    }
    const { output } = await api.workerServiceAction("status");
    setWorkerState({ running: /running=true/i.test(output), service: /installed=true/i.test(output) });
  };

  const setStartWorkerOnLogin = async (enabled: boolean) => {
    if (!workerManager) return;
    setServiceError(null);
    try {
      await workerManager.setServiceEnabled(enabled);
      await updateAppConfig({ startWorkerOnLogin: enabled });
    } catch (cause) {
      setServiceError(cause instanceof Error ? cause.message : "Could not update worker sign-in startup.");
    }
  };

  return (
    <div className="space-y-6">
      {runtime === "desktop" && (
        <Group title="Behaviour">
          <Field
            label="Run in background"
            hint="Closing the window keeps the daemon running in the tray."
          >
            <Switch
              checked={appConfig.runInBackground}
              onChange={(checked) => void updateAppConfig({ runInBackground: checked })}
            />
          </Field>
          {appConfig.localWorkerInstalled && workerManager && <Field label="Start worker when I sign in" hint="The worker starts without opening the desktop app.">
            <Switch checked={appConfig.startWorkerOnLogin} onChange={(checked) => void setStartWorkerOnLogin(checked)} />
          </Field>}
          {appConfig.localWorkerInstalled && workerManager && <Field label="Worker lifecycle" hint={workerState?.service ? "Managed by the system service." : "Managed by the desktop app."}>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={workerState?.running === true} onClick={() => void workerManager.start().then(async () => setWorkerState({ running: true, service: (await workerManager.serviceStatus()).installed }))}>Start</Button>
              <Button size="sm" variant="outline" disabled={workerState?.running !== true} onClick={() => void workerManager.stop().then(() => setWorkerState((current) => current ? { ...current, running: false } : current))}>Stop</Button>
              <Button size="sm" variant="outline" onClick={() => void workerManager.restart().then(async () => setWorkerState({ running: true, service: (await workerManager.serviceStatus()).installed }))}>Restart</Button>
            </div>
          </Field>}
          {remoteWorker && <Field label="Remote worker lifecycle" hint={workerState ? (workerState.service ? "Managed by its system service." : "Remote administration is enabled, but no service is installed.") : "Remote administration is disabled or unavailable."}>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={!workerState || workerState.running} onClick={() => void remoteAction(workerState?.service ? "start" : "restart")}>Start</Button>
              <Button size="sm" variant="outline" disabled={!workerState?.running} onClick={() => void remoteAction("stop")}>Stop</Button>
              <Button size="sm" variant="outline" disabled={!workerState} onClick={() => void remoteAction("restart")}>Restart</Button>
              <Button size="sm" variant="outline" disabled={!workerState} onClick={() => void remoteAction(workerState?.service ? "uninstall" : "install")}>{workerState?.service ? "Disable service" : "Enable service"}</Button>
            </div>
          </Field>}
          {serviceError && <p className="text-xs text-red-300">{serviceError}</p>}
        </Group>
      )}

      <Group title="About">
        <Field label="Runtime">
          <span className="text-sm text-neutral-400">{runtime}</span>
        </Field>
        <Field label="Active server">
          <span className="text-sm text-neutral-400">{active?.name ?? "—"}</span>
        </Field>
      </Group>
    </div>
  );
};

export const RemoteWorkersSettings: React.FC = () => {
  const { runtime, workerManager } = useOrquester();
  const connections = useAppStore((s) => s.connections);
  const addRemote = useAppStore((s) => s.addRemote);
  const removeRemote = useAppStore((s) => s.removeRemote);
  const selectConnection = useAppStore((s) => s.selectConnection);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [localWorker, setLocalWorker] = useState<{ installed: boolean; running: boolean; source: "repository" | "release" } | null>(null);

  useEffect(() => {
    void workerManager?.status().then(setLocalWorker).catch(() => setLocalWorker(null));
  }, [workerManager]);

  const installLocalWorker = async () => {
    if (!workerManager) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await workerManager.install();
      await workerManager.start();
      setLocalWorker(await workerManager.status());
      window.location.reload();
    } catch (cause) {
      setInstallError(cause instanceof Error ? cause.message : "Could not install the local worker.");
    } finally {
      setInstalling(false);
    }
  };

  const submit = async () => {
    if (!url.trim()) {
      return;
    }
    const id = await addRemote({ name, baseUrl: url, username, password });
    setAdding(false);
    setName("");
    setUsername("");
    setUrl("");
    setPassword("");
    await selectConnection(id);
  };

  return (
    <div className="space-y-6">
      <Group title="Workers">
        {runtime === "desktop" && workerManager && !localWorker?.installed && (
          <div className="flex items-center gap-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-400"><Laptop size={15} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm text-neutral-200">Install on this PC</span><span className="block text-xs text-neutral-500">Download and start a local Orquester worker.</span></span>
            <Button size="sm" variant="outline" disabled={installing} onClick={() => void installLocalWorker()}>{installing ? "Installing…" : "Install"}</Button>
          </div>
        )}
        {runtime === "desktop" && localWorker?.installed && (
          <div className="flex items-center gap-3 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-emerald-400"><Laptop size={15} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm text-neutral-200">Local worker installed</span><span className="block text-xs text-neutral-500">{localWorker.running ? "Running on this PC" : "Installed on this PC"} · {localWorker.source === "repository" ? "Development build" : "Release build"}</span></span>
            <span className="shrink-0 text-[11px] text-neutral-600">Local</span>
          </div>
        )}
        {connections.map((connection) => (
          <div key={connection.id} className="flex items-center gap-3 py-3">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                connection.kind === "local" ? "bg-neutral-800 text-neutral-400" : "bg-neutral-800/70 text-neutral-500"
              )}
            >
              {connection.kind === "local" ? <LockKeyhole size={14} /> : <Globe2 size={15} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-200">{connection.name}</span>
              <span className="block truncate text-xs text-neutral-500">
                {connection.kind === "local" ? "This device · always available" : connection.endpoint}
              </span>
            </span>
            {connection.kind === "local" ? (
              <span className="shrink-0 text-[11px] text-neutral-600">Local</span>
            ) : (
              <button
                type="button"
                aria-label={`Remove ${connection.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-red-400"
                onClick={() => void removeRemote(connection.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}

        {adding ? (
          <div className="space-y-2.5 py-3">
            <Input aria-label="Worker name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              aria-label="Worker URL"
              type="url"
              placeholder="https://host:47831"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Input
              aria-label="Worker password"
              type="password"
              placeholder="Token (optional)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input aria-label="Worker username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={!url.trim()} onClick={() => void submit()}>
                Add Worker
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 py-3 text-left text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            onClick={() => setAdding(true)}
          >
            <Plus size={15} />
            Add remote worker
          </button>
        )}
        {installError && <p className="py-2 text-xs text-red-300">{installError}</p>}
      </Group>
    </div>
  );
};
