import type { RegistryEntryDef } from "../index";

export const opencode: RegistryEntryDef = {
  id: "opencode",
  name: "OpenCode",
  kind: "agent",
  bin: ["opencode"],
  versionFlag: "--version",
  installCmd: "npm install -g opencode-ai",
  updateCmd: "npm update -g opencode-ai"
};
