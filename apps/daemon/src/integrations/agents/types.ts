import type { RegistryActionResult, RegistryAuthInfo, RegistryQuota } from "@orquester/api";

export interface AgentDefinition {
  id: string;
  name: string;
  kind: "agent";
  bin: readonly string[];
  versionFlag?: string;
  installCmd?: string;
  updateCmd?: string;
}

export interface AgentCommandContext {
  bin: string;
  call(args: readonly string[]): Promise<RegistryActionResult>;
  callInteractive?(args: readonly string[], stopWhen?: RegExp): Promise<RegistryActionResult>;
  appServerCall?(method: string, params?: unknown): Promise<unknown>;
}

export interface AgentIntegration {
  id: string;
  getVersion?: (ctx: AgentCommandContext) => Promise<string | undefined>;
  getAuthStatus?: (ctx: AgentCommandContext) => Promise<RegistryAuthInfo>;
  getQuota?: (ctx: AgentCommandContext) => Promise<RegistryQuota>;
}

export function unsupportedQuota(id: string, provider: string, message?: string): RegistryQuota {
  return {
    id,
    provider,
    auth: { status: "unknown", message: "Authentication status is not exposed by this provider." },
    supported: false,
    fetchedAt: new Date().toISOString(),
    windows: [],
    message: message ?? "This provider does not expose quota usage through its CLI yet."
  };
}

export function firstOutputLine(output: string): string | undefined {
  return output.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 80);
}
