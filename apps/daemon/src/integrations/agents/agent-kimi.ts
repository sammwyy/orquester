import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

const kimiInstallCommand = process.platform === "win32"
  ? 'powershell -NoProfile -Command "irm https://code.kimi.com/kimi-code/install.ps1 | iex"'
  : "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash";

export const kimiDefinition: AgentDefinition = {
  id: "kimi",
  name: "Kimi Code",
  kind: "agent",
  bin: ["kimi"],
  versionFlag: "--version",
  installCmd: kimiInstallCommand,
  updateCmd: "kimi upgrade",
  websiteUrl: "https://code.kimi.com/"
};

export const kimiIntegration: AgentIntegration = {
  id: "kimi",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota() {
    return unsupportedQuota("kimi", "Kimi Code", "Kimi usage is not configured for this integration yet.");
  }
};
