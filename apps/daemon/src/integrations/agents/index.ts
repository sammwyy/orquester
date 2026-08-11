import type { AgentIntegration } from "./types";
import { claudeIntegration } from "./agent-claude";
import { codexIntegration } from "./agent-codex";
import { deepseekIntegration } from "./agent-deepseek";
import { geminiIntegration } from "./agent-gemini";
import { grokIntegration } from "./agent-grok";
import { opencodeIntegration } from "./agent-opencode";

export const AGENT_INTEGRATIONS: ReadonlyMap<string, AgentIntegration> = new Map([
  [claudeIntegration.id, claudeIntegration],
  [codexIntegration.id, codexIntegration],
  [deepseekIntegration.id, deepseekIntegration],
  [geminiIntegration.id, geminiIntegration],
  [grokIntegration.id, grokIntegration],
  [opencodeIntegration.id, opencodeIntegration]
]);
