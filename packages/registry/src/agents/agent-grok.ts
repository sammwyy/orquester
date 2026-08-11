import type { RegistryEntryDef } from "../index";

export const grok: RegistryEntryDef = {
  id: "grok",
  name: "Grok Build",
  kind: "agent",
  bin: ["grok"],
  versionFlag: "--version",
  installCmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
  updateCmd: "grok update"
};
