import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const geminiDefinition: AgentDefinition = {
  id: "gemini", name: "Gemini CLI", kind: "agent", bin: ["gemini"],
  versionFlag: "--version", installCmd: "npm install -g @google/gemini-cli", updateCmd: "npm update -g @google/gemini-cli"
};

export const geminiIntegration: AgentIntegration = {
  id: "gemini",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota() {
    return unsupportedQuota("gemini", "Google Gemini CLI");
  }
};
