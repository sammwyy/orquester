import React, { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button, Input, Modal } from "../ui";
import { useApi } from "../../context/orquester-context";
import { useAppStore } from "../../store/app";

export const SudoPasswordModal: React.FC = () => {
  const api = useApi();
  const prompt = useAppStore((state) => state.sudoPrompt);
  const clearPrompt = useAppStore((state) => state.clearSudoPrompt);
  const agent = useAppStore((state) => state.registry.agents.find((entry) => entry.id === prompt?.agentId));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!prompt || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.provideInstallPassword(prompt.agentId, password);
      setPassword("");
      if (!result.accepted) {
        setError("The installation is no longer waiting for a password.");
      } else {
        clearPrompt();
      }
    } catch {
      setError("Could not send the password to the local daemon.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (prompt) void api.cancelInstallPassword(prompt.agentId);
    clearPrompt();
  };

  return (
    <Modal open={Boolean(prompt)} onClose={cancel} className="max-w-md">
      <div className="w-full p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <ShieldCheck size={18} />
          </span>
          <div>
            <h2 className="text-sm font-medium text-neutral-100">Administrator permission required</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              {agent?.name ?? "This installation"} needs your administrator password to continue.
            </p>
          </div>
        </div>
        <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <Input
            autoFocus
            type="password"
            value={password}
            placeholder="Password"
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <p className="flex items-center gap-1.5 text-xs text-amber-300"><AlertTriangle size={13} />{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={busy || !password}>{busy ? "Sending…" : "Continue"}</Button>
          </div>
        </form>
        <p className="mt-4 text-[11px] leading-4 text-neutral-600">The password is sent only to this local daemon and is never stored.</p>
      </div>
    </Modal>
  );
};
