import React, { useEffect, useState } from "react";
import type { DaemonConfig } from "@orquester/config";
import type { ApiClient } from "../../../lib/api-client";
import { Button, Input, Switch } from "../../ui";
import { useApi } from "../../../context/orquester-context";
import { useAppStore } from "../../../store/app";
import { Field, Group } from "./shared";
export const StorageSettings: React.FC = () => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";

  const [workspacesDir, setWorkspacesDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setWorkspacesDir(config.workspacesDir);
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
        workspacesDir
      });
      setMessage("Saved. Storage changes apply immediately.");
    } catch {
      setMessage("Failed to save (daemon config is editable only over the local socket).");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {!isLocal && (
        <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
          Storage settings are read-only while connected to a remote worker. Change them from that
          worker’s local app.
        </div>
      )}

      <Group title="Storage">
        <Field label="Workspaces directory" hint="Supports $userhome / $appdir variables.">
          <Input
            className="w-40 sm:w-64"
            value={workspacesDir}
            disabled={!isLocal}
            onChange={(e) => setWorkspacesDir(e.target.value)}
          />
        </Field>
      </Group>

      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}

      {isLocal && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save storage settings"}
        </Button>
      )}
    </div>
  );
};

const DaemonAccessSettings: React.FC<{
  api: ApiClient | null;
  editable: boolean;
  remote?: boolean;
  onGoToLocalAccess?: () => void;
}> = ({ api, editable, remote = false, onGoToLocalAccess }) => {
  const [httpEnabled, setHttpEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [serveWeb, setServeWeb] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!api) {
      setMessage("Local worker is not available.");
      return;
    }
    let active = true;
    setMessage(null);
    api
      .getDaemonConfig()
      .then((config: DaemonConfig) => {
        if (!active) return;
        setHttpEnabled(config.transports.http.enabled);
        setHost(config.transports.http.host);
        setPort(String(config.transports.http.port));
        setUsername(config.transports.http.username ?? "");
        setServeWeb(config.transports.http.serveWeb);
      })
      .catch(() => setMessage("Could not load access settings."));
    return () => {
      active = false;
    };
  }, [api]);

  const save = async () => {
    if (!api || !editable) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.updateDaemonConfig({
        transports: {
          http: {
            enabled: httpEnabled,
            host,
            port: Number(port) || 47831,
            ...(username ? { username } : {}),
            serveWeb,
            ...(password ? { password } : {})
          }
        }
      });
      setPassword("");
      setMessage("Saved. Access changes apply immediately.");
    } catch {
      setMessage("Failed to save access settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {remote && (
        <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
          <p>This worker’s access settings are read-only here. Change them from its local app.</p>
          {onGoToLocalAccess && (
            <Button size="sm" variant="outline" className="mt-3" onClick={onGoToLocalAccess}>
              Go to Local Access
            </Button>
          )}
        </div>
      )}

      <Group title="HTTP Access">
        <Field label="Enabled" hint="Allow other clients to reach this worker.">
          <Switch checked={httpEnabled} disabled={!editable} onChange={setHttpEnabled} />
        </Field>
        <Field label="Host">
          <Input className="w-40 sm:w-64" value={host} disabled={!editable} onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field label="Port">
          <Input className="w-40 sm:w-64" value={port} disabled={!editable} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field label="Username" hint="Required for remote HTTP access.">
          <Input className="w-40 sm:w-64" value={username} disabled={!editable} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" hint="Min 8 chars. Leave blank to keep current.">
          <Input
            className="w-40 sm:w-64"
            type="password"
            placeholder="••••••••"
            value={password}
            disabled={!editable}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Browser client" hint="Serve Orquester from this worker over HTTP.">
          <Switch checked={serveWeb} disabled={!editable} onChange={(checked) => {
            setServeWeb(checked);
            if (checked) setHttpEnabled(true);
          }} />
        </Field>
      </Group>

      {message && <p className="px-1 text-xs text-neutral-400">{message}</p>}

      {editable && (
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save access settings"}
        </Button>
      )}
    </div>
  );
};

export const LocalAccessSettings: React.FC = () => {
  const localApi = useAppStore((s) => s.localApi);
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const active = connections.find((connection) => connection.id === activeId);
  return (
    <div className="space-y-4">
      {active?.kind === "remote" && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200/80">
          You are connected to {active.name}. These settings belong to this PC’s local worker, not the remote worker currently selected.
        </div>
      )}
      <DaemonAccessSettings api={localApi} editable />
    </div>
  );
};

export const AccessSettings: React.FC<{ onGoToLocalAccess?: () => void }> = ({ onGoToLocalAccess }) => {
  const api = useApi();
  const connections = useAppStore((s) => s.connections);
  const activeId = useAppStore((s) => s.activeConnectionId);
  const isLocal = connections.find((c) => c.id === activeId)?.kind === "local";
  if (isLocal) {
    return (
      <div className="rounded-xl border border-neutral-800/70 bg-neutral-950 p-3 text-xs text-neutral-400">
        Local worker access is configured in Local Access so it is always clear these settings apply to this PC.
        {onGoToLocalAccess && <Button size="sm" variant="outline" className="mt-3" onClick={onGoToLocalAccess}>Go to Local Access</Button>}
      </div>
    );
  }
  return <DaemonAccessSettings api={api} editable={false} remote onGoToLocalAccess={onGoToLocalAccess} />;
};
