import type { RegistryEntryDef } from "../index";

export const deepseek: RegistryEntryDef = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "agent",
  bin: ["deepseek"],
  versionFlag: "--version",
  installCmd: "npm install -g @deepseek-ai/deepseek-cli",
  updateCmd: "npm update -g @deepseek-ai/deepseek-cli"
};
