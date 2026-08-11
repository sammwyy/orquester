import { firstOutputLine, unsupportedQuota, type AgentDefinition, type AgentIntegration } from "./types";

export const clineDefinition: AgentDefinition = {
  id: "cline",
  name: "Cline",
  kind: "agent",
  bin: ["cline"],
  binDeps: ["npm"],
  versionFlag: "--version",
  installCmd: "npm i -g cline",
  updateCmd: "npm i -g cline",
  websiteUrl: "https://cline.bot/"
};

export const clineIntegration: AgentIntegration = {
  id: "cline",
  async getVersion(ctx) {
    const result = await ctx.call(["--version"]);
    return result.ok ? firstOutputLine(result.output) : undefined;
  },
  async getQuota() {
    return unsupportedQuota("cline", "Cline");
  }
};
