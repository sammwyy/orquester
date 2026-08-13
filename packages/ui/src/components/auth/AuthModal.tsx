import React, { useState } from "react";
import { Lock } from "lucide-react";
import { Button, Input, Modal } from "../ui";
import { useAppStore } from "../../store/app";

/**
 * Password prompt for a token-protected daemon (web). The password is turned
 * into a bcrypt hash (using the daemon's salt) and only that hash is stored;
 * the plaintext never leaves the form.
 */
export const AuthModal: React.FC = () => {
  const authPrompt = useAppStore((s) => s.authPrompt);
  const connections = useAppStore((s) => s.connections);
  const submitPassword = useAppStore((s) => s.submitPassword);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!authPrompt) {
    return null;
  }

  const connection = connections.find((c) => c.id === authPrompt.connectionId);

  const submit = async () => {
    if (!username.trim() || !password || busy) {
      return;
    }
    setBusy(true);
    await submitPassword(username, password);
    setBusy(false);
    setPassword("");
  };

  return (
    <Modal
      open
      onClose={() => useAppStore.setState({ authPrompt: null })}
      className="max-w-sm"
    >
      <div className="w-full p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300">
            <Lock size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-100">Authentication required</p>
            <p className="truncate text-xs text-neutral-500">{connection?.name ?? "Server"}</p>
          </div>
        </div>

        <Input
          autoFocus
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void submit();
            }
          }}
        />

        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => useAppStore.setState({ authPrompt: null })}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={!username.trim() || !password || busy} onClick={() => void submit()}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
