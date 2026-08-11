import type { RegistryEntryDef } from "../index";

export const claude: RegistryEntryDef = {
  id: "claude",
  name: "Claude Code",
  kind: "agent",
  bin: ["claude"],
  versionFlag: "--version",
  installCmd: "npm install -g @anthropic-ai/claude-code",
  updateCmd: "npm update -g @anthropic-ai/claude-code"
};
