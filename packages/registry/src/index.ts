import type { RegistryKind } from "@orquester/api";

export type { RegistryKind };

export interface RegistryEntryDef {
  id: string;
  name: string;
  kind: RegistryKind;
  bin: readonly string[];
  versionFlag?: string;
  installCmd?: string;
  updateCmd?: string;
}

export const REGISTRY = {
  shells: [
    { id: "bash", name: "Bash", kind: "shell", bin: ["bash"] as const },
    { id: "zsh", name: "Zsh", kind: "shell", bin: ["zsh"] as const },
    { id: "fish", name: "Fish", kind: "shell", bin: ["fish"] as const },
    { id: "nu", name: "Nushell", kind: "shell", bin: ["nu"] as const },
    { id: "pwsh", name: "PowerShell", kind: "shell", bin: ["pwsh", "powershell"] as const },
    { id: "cmd", name: "Command Prompt", kind: "shell", bin: ["cmd"] as const },
    { id: "sh", name: "sh", kind: "shell", bin: ["sh"] as const }
  ] as const
} as const;
