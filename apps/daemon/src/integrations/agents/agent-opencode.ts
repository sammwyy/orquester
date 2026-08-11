import { firstOutputLine, unsupportedQuota, type AgentIntegration } from "./types";

export const opencodeIntegration: AgentIntegration = {
  id: "opencode",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getAuthStatus(ctx) {
    const result = await ctx.call(["auth", "list"]);
    if (!result.ok) return { status: "unknown" as const, message: "OpenCode auth status could not be read." };
    const credentials = result.output.match(/(\d+) credentials?/i)?.[1];
    if (credentials && Number(credentials) > 0) {
      return { status: "authenticated" as const, account: `${credentials} provider credentials` };
    }
    return { status: "unauthenticated" as const };
  },
  async getQuota() {
    return unsupportedQuota("opencode", "OpenCode", "Quota is not supported by OpenCode yet.");
  }
};
