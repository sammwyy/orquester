import type { RegistryEntryDef } from "../index";

export const gemini: RegistryEntryDef = {
  id: "gemini",
  name: "Gemini CLI",
  kind: "agent",
  bin: ["gemini"],
  versionFlag: "--version",
  installCmd: "npm install -g @google/gemini-cli",
  updateCmd: "npm update -g @google/gemini-cli"
};
