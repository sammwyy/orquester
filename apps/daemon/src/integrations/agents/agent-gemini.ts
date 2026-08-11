import { firstOutputLine, unsupportedQuota, type AgentIntegration } from "./types";

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
