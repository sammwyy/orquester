import React, { useState } from "react";
import { ArrowLeft, Check, Laptop, LoaderCircle, MonitorUp, Network, Settings2 } from "lucide-react";
import { useOrquester } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";
import { Button, Input, Modal, Switch } from "../ui";

type SetupChoice = "local" | "remote" | "both";
type Step = "mode" | "remote" | "local" | "install";

const choices: Array<{ id: SetupChoice; title: string; description: string; icon: React.ReactNode }> = [
  { id: "local", title: "This PC", description: "Install a worker here and keep your projects local.", icon: <Laptop size={20} /> },
  { id: "remote", title: "Another PC", description: "Connect to a worker that is already running elsewhere.", icon: <Network size={20} /> },
  { id: "both", title: "This PC and others", description: "Start locally, with the option to switch to remote workers.", icon: <MonitorUp size={20} /> }
];

const titleFor: Record<Step, string> = {
  mode: "Where will your work run?",
  remote: "Connect a remote worker",
  local: "Set up this PC",
  install: "Ready to set up Orquester"
};

const iconFor: Record<Step, React.ReactNode> = {
  mode: <MonitorUp size={18} />,
  remote: <Network size={18} />,
  local: <Settings2 size={18} />,
  install: <Check size={18} />
};

export const Onboarding: React.FC = () => {
  const { runtime, workerManager } = useOrquester();
  const appConfig = useAppStore((state) => state.appConfig);
  const updateAppConfig = useAppStore((state) => state.updateAppConfig);
  const addRemote = useAppStore((state) => state.addRemote);
  const selectConnection = useAppStore((state) => state.selectConnection);
  const [choice, setChoice] = useState<SetupChoice | null>(null);
  const [step, setStep] = useState<Step>("mode");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [runInBackground, setRunInBackground] = useState(false);
  const [remoteAccess, setRemoteAccess] = useState(false);
  const [localPort, setLocalPort] = useState("47831");
  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [serveWeb, setServeWeb] = useState(false);
  const [workspacesDir, setWorkspacesDir] = useState<string | undefined>();

  if (runtime !== "desktop" || appConfig.setupComplete) return null;

  const chooseMode = (next: SetupChoice) => {
    setChoice(next);
    setError(null);
    setStep(next === "local" ? "local" : "remote");
  };

  const saveRemote = async () => {
    if (!url.trim()) {
      setError("Enter the URL of the remote worker, or skip this step.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const remoteId = await addRemote({ name, baseUrl: url, username, password });
      if (choice === "remote") {
        await updateAppConfig({ setupComplete: true, localWorkerInstalled: false });
        await selectConnection(remoteId);
      } else {
        setStep("local");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the remote worker.");
    } finally {
      setWorking(false);
    }
  };

  const install = async () => {
    setWorking(true);
    setError(null);
    try {
      if (!workerManager) throw new Error("This client cannot install a local worker.");
      await workerManager.install();
      await workerManager.configure({ runInBackground, remoteAccess, port: Number(localPort), username: localUsername, password: localPassword, serveWeb, workspacesDir });
      await updateAppConfig({ runInBackground, setupComplete: true, localWorkerInstalled: true });
      await workerManager.start();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not install the local worker.");
    } finally {
      setWorking(false);
    }
  };

  const back = () => {
    setError(null);
    if (step === "mode") return;
    if (step === "remote") setStep("mode");
    else if (step === "local") setStep(choice === "both" ? "remote" : "mode");
    else setStep("local");
  };

  const skipRemote = () => {
    setError(null);
    setUrl("");
    setPassword("");
    setUsername("");
    setName("");
    setStep(choice === "both" ? "local" : "mode");
  };

  const chooseWorkspaces = async () => {
    if (!workerManager) return;
    const directory = await workerManager.chooseWorkspacesDirectory();
    if (directory) setWorkspacesDir(directory);
  };

  return (
    <Modal open onClose={() => undefined} className="max-w-xl" backdropDraggable>
      <div className="w-full p-6">
        <div className="relative flex items-center gap-3">
          {step !== "mode" && <button type="button" aria-label="Back" className="app-no-drag absolute -left-5 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" onClick={back}><ArrowLeft size={18} /></button>}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">{iconFor[step]}</span>
          <div className="min-w-0 flex-1"><p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Welcome to Orquester</p><h2 className="mt-1 text-xl font-semibold text-neutral-100">{titleFor[step]}</h2></div>
          <span className="text-xs text-neutral-600">{step === "mode" ? "1" : step === "remote" ? "2" : "3"} / 3</span>
        </div>

        {step === "mode" && <div className="mt-5 space-y-2">
          <p className="text-sm text-neutral-400">Choose a starting point. Everything here can be changed later in Settings, including workers, connections, and background behaviour.</p>
          {choices.map((item) => <button key={item.id} type="button" onClick={() => chooseMode(item.id)} className="app-no-drag flex w-full items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-600 hover:bg-neutral-800/60"><span className="mt-0.5 text-neutral-400">{item.icon}</span><span><span className="block text-sm text-neutral-100">{item.title}</span><span className="mt-0.5 block text-xs text-neutral-500">{item.description}</span></span></button>)}
        </div>}

        {step === "remote" && <div className="mt-5 space-y-3">
          <p className="text-sm text-neutral-400">Enter the address of a worker you already configured. For example, <code className="text-neutral-300">https://my-pc:47831</code>.</p>
          <Input aria-label="Remote worker name" placeholder="Name, e.g. Home PC" value={name} onChange={(event) => setName(event.target.value)} />
          <Input aria-label="Remote worker address" type="url" placeholder="https://host:47831" value={url} onChange={(event) => setUrl(event.target.value)} />
          <Input aria-label="Remote worker username" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
          <Input aria-label="Remote worker password" type="password" placeholder="Password (if required)" value={password} onChange={(event) => setPassword(event.target.value)} />
          <p className="text-xs text-neutral-600">The password is used only to derive the connection credential; it is not stored as plain text.</p>
          <div className="flex justify-between gap-2 pt-2"><Button variant="ghost" onClick={skipRemote}>Skip for now</Button><Button onClick={() => void saveRemote()} disabled={working}>{working && <LoaderCircle size={14} className="animate-spin" />}{choice === "both" ? "Continue" : "Connect"}</Button></div>
        </div>}

        {step === "local" && <div className="mt-5 space-y-4">
          <p className="text-sm text-neutral-400">Orquester will install a worker for your Windows or Linux account. It can be updated independently of this client.</p>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"><p className="text-sm text-neutral-200">Workspace folder</p><p className="mt-0.5 break-all text-xs text-neutral-500">{workspacesDir ?? "Default: ~/workspaces"}</p><Button size="sm" variant="outline" className="mt-3" onClick={() => void chooseWorkspaces()}>Choose folder</Button></div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"><div className="flex items-start gap-3"><Settings2 size={18} className="mt-0.5 text-neutral-400" /><div className="flex-1"><p className="text-sm text-neutral-200">Keep running in the background</p><p className="mt-0.5 text-xs text-neutral-500">Closing the window keeps the local worker active in the tray.</p></div><Switch checked={runInBackground} onChange={setRunInBackground} /></div></div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 space-y-3"><div className="flex items-start gap-3"><Network size={18} className="mt-0.5 text-neutral-400" /><div className="flex-1"><p className="text-sm text-neutral-200">Allow access from this network</p><p className="mt-0.5 text-xs text-neutral-500">Lets other devices connect to this worker using a username and password.</p></div><Switch checked={remoteAccess} onChange={setRemoteAccess} /></div>{remoteAccess && <div className="space-y-2 pt-1"><Input aria-label="Worker port" inputMode="numeric" placeholder="Port" value={localPort} onChange={(event) => setLocalPort(event.target.value)} /><Input aria-label="Worker username" placeholder="Username" value={localUsername} onChange={(event) => setLocalUsername(event.target.value)} /><Input aria-label="Worker password" type="password" placeholder="Password (at least 8 characters)" value={localPassword} onChange={(event) => setLocalPassword(event.target.value)} /><div className="flex items-center justify-between gap-3 pt-1"><span><span className="block text-sm text-neutral-200">Browser client</span><span className="block text-xs text-neutral-500">Open Orquester from a browser on this network.</span></span><Switch checked={serveWeb} onChange={setServeWeb} /></div></div>}</div>
          <Button className="w-full" onClick={() => setStep("install")}>Review setup</Button>
        </div>}

        {step === "install" && <div className="mt-5 space-y-4"><div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3"><div className="flex gap-3"><Check size={18} className="mt-0.5 text-emerald-400" /><div><p className="text-sm text-neutral-200">Local worker</p><p className="mt-0.5 text-xs text-neutral-500">It will be downloaded, verified, and started for this account.</p></div></div><div className="border-t border-neutral-800 pt-3 text-xs text-neutral-500 space-y-1"><p>Workspace folder: {workspacesDir ?? "~/workspaces"}</p><p>Background: {runInBackground ? "On" : "Off"}</p><p>Remote access: {remoteAccess ? `On · port ${localPort} · user ${localUsername || "not set"} · password ${localPassword ? "set" : "not set"} · browser client ${serveWeb ? "on" : "off"}` : "Off"}</p>{choice === "both" && <p>Remote worker: {url ? `${name || "Unnamed"} · ${url} · user ${username || "not set"} · password ${password ? "set" : "not set"}` : "Not added yet"}</p>}</div></div><Button className="w-full" onClick={() => void install()} disabled={working}>{working && <LoaderCircle size={14} className="animate-spin" />}Install and start worker</Button></div>}

        {error && <p className="mt-4 text-xs text-red-300">{error}</p>}
      </div>
    </Modal>
  );
};
