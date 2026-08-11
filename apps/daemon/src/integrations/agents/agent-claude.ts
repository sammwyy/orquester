import type { QuotaWindow } from "@orquester/api";
import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const claudeDefinition: AgentDefinition = {
  id: "claude", name: "Claude Code", kind: "agent", bin: ["claude"],
  versionFlag: "--version", installCmd: "npm install -g @anthropic-ai/claude-code", updateCmd: "npm update -g @anthropic-ai/claude-code"
};

export const claudeIntegration: AgentIntegration = {
  id: "claude",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getAuthStatus(ctx) {
    const result = await ctx.call(["auth", "status"]);
    try {
      const data = JSON.parse(result.output) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
      if (data.loggedIn) {
        return {
          status: "authenticated" as const,
          account: data.email,
          message: data.subscriptionType ? `${data.subscriptionType} subscription` : undefined
        };
      }
      return { status: "unauthenticated" as const };
    } catch {
      return result.ok
        ? { status: "unknown" as const, message: "Claude returned an unrecognized auth response." }
        : { status: "unauthenticated" as const };
    }
  },
  async getQuota(ctx) {
    const result = await ctx.call(["--print", "/usage"]);
    if (!result.ok) return unsupportedQuota("claude", "Anthropic Claude Code");

    const windows = parseClaudeUsage(result.output);
    return windows.length > 0
      ? {
          id: "claude",
          provider: "Anthropic Claude Code",
          auth: { status: "unknown" as const },
          supported: true,
          fetchedAt: new Date().toISOString(),
          windows
        }
      : unsupportedQuota("claude", "Anthropic Claude Code");
  }
};

function parseClaudeUsage(output: string): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(Current session|Current week(?:\s+\([^)]*\))?)\s*:\s*(\d+(?:\.\d+)?)%\s+used\s*[·-]\s*resets?\s+(.+)$/i);
    if (!match) continue;
    const used = Number(match[2]);
    const isWeek = /^Current week/i.test(match[1]);
    windows.push({
      id: isWeek ? "weekly" : "session",
      label: isWeek ? "Current week" : "Current session",
      period: isWeek ? "weekly" : "rolling",
      unit: "unknown",
      limit: 100,
      used,
      remaining: Math.max(0, 100 - used),
      percentUsed: used,
      resetsAt: normalizeClaudeReset(match[3].trim()),
      resetLabel: match[3].trim()
    });
  }
  return windows;
}

function normalizeClaudeReset(value: string): string | undefined {
  const match = value.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*\(([^)]+)\)$/i);
  if (!match) return undefined;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[1].toLowerCase());
  if (month === -1) return undefined;
  let hour = Number(match[3]);
  if (match[5].toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (match[5].toLowerCase() === "am" && hour === 12) hour = 0;
  const now = new Date();
  const localAsUtc = Date.UTC(now.getFullYear(), month, Number(match[2]), hour, Number(match[4]));
  const timeZone = match[6];
  let candidate = new Date(localAsUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(candidate);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const renderedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    candidate = new Date(localAsUtc - (renderedAsUtc - candidate.getTime()));
  }
  if (Number.isNaN(candidate.getTime())) return undefined;
  return candidate.toISOString();
}
