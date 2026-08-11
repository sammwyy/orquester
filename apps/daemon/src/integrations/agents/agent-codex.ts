import { firstOutputLine, unsupportedQuota, type AgentIntegration } from "./types";

export const codexIntegration: AgentIntegration = {
  id: "codex",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getAuthStatus(ctx) {
    if (ctx.appServerCall) {
      try {
        const result = (await ctx.appServerCall("account/read", { refreshToken: false })) as {
          account?: { email?: string; planType?: string; type?: string } | null;
        };
        if (result.account) {
          return {
            status: "authenticated" as const,
            account: result.account.email,
            message: result.account.planType ? `${result.account.planType} plan` : result.account.type
          };
        }
        return { status: "unauthenticated" as const };
      } catch {
        // Fall back to the CLI status command below.
      }
    }
    const result = await ctx.call(["login", "status"]);
    const output = result.output.toLowerCase();
    if (result.ok && /logged in|authenticated|api key/.test(output)) {
      return { status: "authenticated" as const };
    }
    if (/not logged in|not authenticated|no authentication|unauthorized/.test(output)) {
      return { status: "unauthenticated" as const };
    }
    return { status: "unknown" as const, message: "Codex did not return a recognizable auth status." };
  },
  async getQuota(ctx) {
    if (!ctx.appServerCall) return unsupportedQuota("codex", "OpenAI Codex");
    try {
      const result = (await ctx.appServerCall("account/rateLimits/read")) as {
        rateLimits?: {
          primary?: CodexRateLimit | null;
          secondary?: CodexRateLimit | null;
        } | null;
      };
      const windows = [result.rateLimits?.primary, result.rateLimits?.secondary]
        .filter((limit): limit is CodexRateLimit => Boolean(limit))
        .map((limit, index) => ({
          id: index === 0 ? "primary" : "secondary",
          label: labelForWindow(limit.windowDurationMins, index),
          period: periodForWindow(limit.windowDurationMins),
          unit: "unknown" as const,
          limit: 100,
          used: limit.usedPercent,
          remaining: Math.max(0, 100 - limit.usedPercent),
          percentUsed: limit.usedPercent,
          resetsAt: limit.resetsAt ? new Date(limit.resetsAt * 1000).toISOString() : undefined
        }));
      return windows.length > 0
        ? { id: "codex", provider: "OpenAI Codex", auth: { status: "unknown" as const }, supported: true, fetchedAt: new Date().toISOString(), windows }
        : unsupportedQuota("codex", "OpenAI Codex");
    } catch {
      return unsupportedQuota("codex", "OpenAI Codex");
    }
  }
};

interface CodexRateLimit {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt?: number;
}

function periodForWindow(minutes: number): "hourly" | "weekly" | "rolling" | "unknown" {
  if (minutes <= 60) return "hourly";
  if (minutes >= 10_000) return "weekly";
  return "rolling";
}

function labelForWindow(minutes: number, index: number): string {
  if (minutes === 300) return "5-hour limit";
  if (minutes >= 10_000) return "Weekly limit";
  return index === 0 ? "Primary limit" : "Secondary limit";
}
