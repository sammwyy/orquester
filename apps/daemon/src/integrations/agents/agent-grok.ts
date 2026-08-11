import type { QuotaWindow } from "@orquester/api";
import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const grokDefinition: AgentDefinition = {
  id: "grok", name: "Grok Build", kind: "agent", bin: ["grok"],
  versionFlag: "--version", installCmd: "curl -fsSL https://x.ai/cli/install.sh | bash", updateCmd: "grok update", websiteUrl: "https://x.ai/"
};

export const grokIntegration: AgentIntegration = {
  id: "grok",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getAuthStatus(ctx) {
    const result = await ctx.call(["models"]);
    const output = result.output.toLowerCase();
    if (result.ok && /logged in with grok\.com|logged in/.test(output)) {
      const model = result.output.match(/Default model:\s*(.+)/i)?.[1]?.trim();
      return {
        status: "authenticated" as const,
        account: "grok.com",
        message: model ? `default ${model}` : undefined
      };
    }
    if (/not logged in|login required|unauthenticated/.test(output)) {
      return { status: "unauthenticated" as const };
    }
    return { status: "unknown" as const, message: "Grok did not return a recognizable auth status." };
  },
  async getQuota(ctx) {
    if (!ctx.callInteractive) {
      return unsupportedQuota("grok", "Grok Build", "Grok usage requires an interactive terminal.");
    }
    const result = await ctx.callInteractive(["--minimal", "/usage"], /(?:Current week.*resets|Next reset)/i);
    const windows = parseGrokUsage(result.output);
    return windows.length > 0
      ? {
          id: "grok",
          provider: "Grok Build",
          auth: { status: "unknown" as const },
          supported: true,
          fetchedAt: new Date().toISOString(),
          windows
        }
      : unsupportedQuota("grok", "Grok Build", "Grok did not return a recognizable usage response.");
  }
};

function parseGrokUsage(output: string): QuotaWindow[] {
  const clean = output
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b_[^\u001b]*(?:\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\r/g, "");
  const windows: QuotaWindow[] = [];
  let pendingReset: string | undefined;
  for (const line of clean.split("\n")) {
    const reset = line.match(/Next reset:\s*([A-Za-z]+\s+\d{1,2},\s+\d{1,2}:\d{2})/i)?.[1]?.trim();
    const current = line.match(/Current week(?:\s*\([^)]*\))?\s*:\s*(\d+(?:\.\d+)?)%\s+used\s*[·-]\s*resets?\s+(.+)/i);
    const weekly = line.match(/Weekly limit:\s*(\d+(?:\.\d+)?)%/i);
    const match = current ?? weekly;
    if (match) {
      const used = Number(match[1]);
      const resetLabel = current?.[2]?.trim() ?? reset ?? pendingReset;
      windows.push({
        id: "weekly",
        label: "Weekly",
        period: "weekly",
        unit: "unknown",
        limit: 100,
        used,
        remaining: Math.max(0, 100 - used),
        percentUsed: used,
        resetsAt: resetLabel ? normalizeGrokReset(resetLabel) : undefined,
        resetLabel
      });
      pendingReset = undefined;
      continue;
    }
    if (reset) {
      pendingReset = reset;
      const previous = windows.at(-1);
      if (previous && !previous.resetLabel) {
        previous.resetLabel = reset;
        previous.resetsAt = normalizeGrokReset(reset);
      }
    }
  }
  return windows;
}

function normalizeGrokReset(value: string): string | undefined {
  const parsed = Date.parse(`${value} ${new Date().getFullYear()}`);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
