import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { desktopReleasePage, getClientUpdate, getWorkerUpdate, workerReleasePage, type WorkerReleaseChannel, type WorkerUpdate } from "../../../lib/worker-release";
import { useOrquester } from "../../../context/orquester-context";
import { useAppStore } from "../../../store/app";
import { Button, Switch } from "../../ui";
import { Field, Group } from "./shared";

const channelFor = (channel: "stable" | "nightly"): WorkerReleaseChannel =>
  channel === "nightly" ? "unstable" : "stable";

const Version: React.FC<{ current: string; update: WorkerUpdate | null }> = ({ current, update }) => (
  <div className="min-w-0 text-right text-xs">
    <p className="text-neutral-300">Current: {current}</p>
    <p className={update?.updateAvailable ? "text-amber-300" : "text-neutral-500"}>
      {update?.latest ? `Latest: ${update.latest.version}` : "No release in this channel"}
    </p>
  </div>
);

export const UpdatesSettings: React.FC = () => {
  const { api, clientVersion, openExternal } = useOrquester();
  const appConfig = useAppStore((state) => state.appConfig);
  const updateAppConfig = useAppStore((state) => state.updateAppConfig);
  const [clientUpdate, setClientUpdate] = useState<WorkerUpdate | null>(null);
  const [workerUpdate, setWorkerUpdate] = useState<WorkerUpdate | null>(null);
  const [workerVersion, setWorkerVersion] = useState("Unknown");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const health = await api.health();
      const channel = channelFor(appConfig.updateChannel);
      const [client, worker] = await Promise.all([
        getClientUpdate(clientVersion, channel),
        getWorkerUpdate(health.version, channel)
      ]);
      setWorkerVersion(health.version);
      setClientUpdate(client);
      setWorkerUpdate(worker);
    } catch {
      setMessage("Could not check for updates. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [api, appConfig.updateChannel, clientVersion]);

  useEffect(() => {
    if (appConfig.searchForUpdates) void check();
  }, [appConfig.searchForUpdates, check]);

  const update = async () => {
    const clientLatest = clientUpdate?.latest;
    const latest = clientLatest ?? workerUpdate?.latest;
    if (!latest) return;
    if (!clientLatest) {
      try {
        await api.updateWorker();
        setMessage("Worker update downloaded. It will restart safely now.");
      } catch {
        setMessage("This worker cannot be updated from the current connection. Use its local client.");
      }
      return;
    }
    const url = clientLatest ? desktopReleasePage(latest.version) : workerReleasePage(latest.version);
    const opened = openExternal ? await openExternal(url) : window.open(url, "_blank") !== null;
    setMessage(opened ? `Opening the ${clientLatest ? "desktop" : "worker"} release.` : "Could not open the release page.");
  };

  const available = Boolean(clientUpdate?.updateAvailable || workerUpdate?.updateAvailable);

  return (
    <div className="space-y-6">
      <Group title="Updates">
        <Field label="Search for updates automatically" hint="Checks the selected release channel when the app starts.">
          <Switch checked={appConfig.searchForUpdates} onChange={(checked) => void updateAppConfig({ searchForUpdates: checked })} />
        </Field>
        <Field label="Channel">
          <div className="flex rounded-lg border border-neutral-700 p-0.5 text-xs">
            {(["stable", "nightly"] as const).map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => void updateAppConfig({ updateChannel: channel })}
                className={`rounded-md px-2 py-1 capitalize ${appConfig.updateChannel === channel ? "bg-neutral-700 text-neutral-100" : "text-neutral-500"}`}
              >
                {channel}
              </button>
            ))}
          </div>
        </Field>
      </Group>

      <Group title="Versions">
        <Field label="Client"><Version current={clientVersion} update={clientUpdate} /></Field>
        <Field label="Worker"><Version current={workerVersion} update={workerUpdate} /></Field>
      </Group>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => void check()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Check now
        </Button>
        <Button onClick={() => void update()} disabled={!available || loading}>Update</Button>
      </div>
      {message && <p className="text-xs text-neutral-500">{message}</p>}
    </div>
  );
};
