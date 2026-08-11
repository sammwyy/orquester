import type { AgentDefinition, AgentIntegration } from "./types";
import { claudeDefinition, claudeIntegration } from "./agent-claude";
import { clineDefinition, clineIntegration } from "./agent-cline";
import { codexDefinition, codexIntegration } from "./agent-codex";
import { deepseekDefinition, deepseekIntegration } from "./agent-deepseek";
import { geminiDefinition, geminiIntegration } from "./agent-gemini";
import { grokDefinition, grokIntegration } from "./agent-grok";
import { opencodeDefinition, opencodeIntegration } from "./agent-opencode";

export const AGENT_DEFS: readonly AgentDefinition[] = [
  claudeDefinition,
  clineDefinition,
  codexDefinition,
  deepseekDefinition,
  geminiDefinition,
  grokDefinition,
  opencodeDefinition
];

export const AGENT_INTEGRATIONS: ReadonlyMap<string, AgentIntegration> = new Map([
  [claudeIntegration.id, claudeIntegration],
  [clineIntegration.id, clineIntegration],
  [codexIntegration.id, codexIntegration],
  [deepseekIntegration.id, deepseekIntegration],
  [geminiIntegration.id, geminiIntegration],
  [grokIntegration.id, grokIntegration],
  [opencodeIntegration.id, opencodeIntegration]
]);
