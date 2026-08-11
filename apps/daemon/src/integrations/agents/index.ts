import type { AgentDefinition, AgentIntegration } from "./types";
import { claudeDefinition, claudeIntegration } from "./agent-claude";
import { antigravityDefinition, antigravityIntegration } from "./agent-antigravity";
import { clineDefinition, clineIntegration } from "./agent-cline";
import { codexDefinition, codexIntegration } from "./agent-codex";
import { deepcodeDefinition, deepcodeIntegration } from "./agent-deepcode";
import { grokDefinition, grokIntegration } from "./agent-grok";
import { kimiDefinition, kimiIntegration } from "./agent-kimi";
import { opencodeDefinition, opencodeIntegration } from "./agent-opencode";

export const AGENT_DEFS: readonly AgentDefinition[] = [
  antigravityDefinition,
  claudeDefinition,
  clineDefinition,
  codexDefinition,
  deepcodeDefinition,
  grokDefinition,
  kimiDefinition,
  opencodeDefinition
];

export const AGENT_INTEGRATIONS: ReadonlyMap<string, AgentIntegration> = new Map([
  [antigravityIntegration.id, antigravityIntegration],
  [claudeIntegration.id, claudeIntegration],
  [clineIntegration.id, clineIntegration],
  [codexIntegration.id, codexIntegration],
  [deepcodeIntegration.id, deepcodeIntegration],
  [grokIntegration.id, grokIntegration],
  [kimiIntegration.id, kimiIntegration],
  [opencodeIntegration.id, opencodeIntegration]
]);
