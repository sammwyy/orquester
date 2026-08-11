import type { QuotaWindow } from "@orquester/api";
import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

const antigravityInstallCommand = process.platform === "win32"
  ? 'powershell -NoProfile -Command "irm https://antigravity.google/cli/install.ps1 | iex"'
  : "curl -fsSL https://antigravity.google/cli/install.sh | bash";

export const antigravityDefinition: AgentDefinition = {
  id: "antigravity",
  name: "Antigravity",
  kind: "agent",
  bin: ["agy"],
  versionFlag: "--version",
  installCmd: antigravityInstallCommand,
  updateCmd: "agy update",
  websiteUrl: "https://antigravity.google/"
};

export const antigravityIntegration: AgentIntegration = {
  id: "antigravity",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota(ctx) {
    const result = await ctx.call(["-p", "/usage"]);
    if (!result.ok) return unsupportedQuota("antigravity", "Antigravity");
    const windows = parseAntigravityUsage(result.output);
    return windows.length > 0
      ? {
          id: "antigravity",
          provider: "Antigravity",
          // A readable usage response means the CLI has an active session.
          auth: { status: "authenticated" as const },
          supported: true,
          fetchedAt: new Date().toISOString(),
          windows
        }
      : unsupportedQuota("antigravity", "Antigravity", "Antigravity did not return a recognizable usage response.");
  }
};

function parseAntigravityUsage(output: string): QuotaWindow[] {
  const windows: QuotaWindow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(Gemini Models|Claude and GPT models)\s+(Weekly Limit|Five Hour Limit)\s+Remaining\s+(\d+(?:\.\d+)?)%\s+(\S+)\s*$/i);
    if (!match) continue;
    const remaining = Number(match[3]);
    const fiveHour = /Five Hour/i.test(match[2]);
    windows.push({
      id: `${match[1].toLowerCase().replace(/\s+/g, "-")}-${fiveHour ? "five-hour" : "weekly"}`,
      label: `${match[1]} · ${fiveHour ? "Five hour" : "Weekly"}`,
      period: fiveHour ? "rolling" : "weekly",
      unit: "unknown",
      limit: 100,
      used: Math.max(0, 100 - remaining),
      remaining,
      percentUsed: Math.max(0, 100 - remaining),
      resetsAt: match[4],
      resetLabel: match[4]
    });
  }
  return windows;
}
