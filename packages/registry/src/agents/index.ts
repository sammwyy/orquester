import { claude } from "./agent-claude";
import { codex } from "./agent-codex";
import { deepseek } from "./agent-deepseek";
import { gemini } from "./agent-gemini";
import { grok } from "./agent-grok";
import { opencode } from "./agent-opencode";

export const AGENT_DEFS = [claude, codex, deepseek, gemini, grok, opencode] as const;
