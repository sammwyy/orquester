import { firstOutputLine, unsupportedQuota, type AgentIntegration } from "./types";

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
