import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const deepseekDefinition: AgentDefinition = {
  id: "deepseek", name: "DeepSeek", kind: "agent", bin: ["deepseek"],
  versionFlag: "--version", installCmd: "npm install -g @deepseek-ai/deepseek-cli", updateCmd: "npm update -g @deepseek-ai/deepseek-cli"
};

export const deepseekIntegration: AgentIntegration = {
  id: "deepseek",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota() {
    return unsupportedQuota("deepseek", "DeepSeek CLI");
  }
};
