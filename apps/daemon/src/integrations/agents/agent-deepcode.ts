import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const deepcodeDefinition: AgentDefinition = {
  id: "deepcode",
  name: "Deep Code",
  kind: "agent",
  bin: ["deepcode"],
  binDeps: ["npm"],
  versionFlag: "--version",
  installCmd: "npm install -g @vegamo/deepcode-cli",
  updateCmd: "npm install -g @vegamo/deepcode-cli",
  websiteUrl: "https://github.com/lessweb/deepcode-cli"
};

export const deepcodeIntegration: AgentIntegration = {
  id: "deepcode",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota() {
    return unsupportedQuota("deepcode", "Deep Code");
  }
};
