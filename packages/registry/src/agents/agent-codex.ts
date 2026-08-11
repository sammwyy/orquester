import type { RegistryEntryDef } from "../index";

export const codex: RegistryEntryDef = {
  id: "codex",
  name: "Codex",
  kind: "agent",
  bin: ["codex"],
  versionFlag: "--version",
  installCmd: "npm install -g @openai/codex",
  updateCmd: "npm update -g @openai/codex"
};
