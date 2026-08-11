import React from "react";
import {
  Bot,
  Code2,
  FolderOpen,
  Globe,
  TerminalSquare
} from "lucide-react";
import type { RegistryKind } from "../types";

// Agents - bare ids only, matching daemon + user SVGs
import Claude from "./agents/claude.svg?react";
import Codex from "./agents/codex.svg?react";
import DeepSeek from "./agents/deepseek.svg?react";
import Gemini from "./agents/gemini.svg?react";
import Grok from "./agents/grok.svg?react";
import OpenCode from "./agents/opencode.svg?react";
import Cline from "./agents/cline.png";
import Kimi from "./agents/kimi.png";

// IDEs - bare ids, matching daemon where possible; filename variants mapped to id
import Antigravity from "./ides/antigravity.svg?react";
import CLion from "./ides/clion.svg?react";
import Cursor from "./ides/cursor.svg?react";
import GoLand from "./ides/goland.svg?react";
import IntelliJ from "./ides/intellij-idea.svg?react";
import PhpStorm from "./ides/phpstorm.svg?react";
import PyCharm from "./ides/pycharm.svg?react";
import RustRover from "./ides/rustrover.svg?react";
import Sublime from "./ides/sublime.svg?react";
import VSCode from "./ides/vscode.svg?react";
import Windsurf from "./ides/windsurf.svg?react";
import Zed from "./ides/zed.svg?react";

// Explorers - only those with SVGs
import Dolphin from "./explorers/dolphin.svg?react";
import Explorer from "./explorers/explorer.svg?react";
import Thunar from "./explorers/thunar.svg?react";

// Browsers - only those with SVGs
import Brave from "./browsers/brave.svg?react";
import Chrome from "./browsers/chrome.svg?react";
import Chromium from "./browsers/chromium.svg?react";
import Edge from "./browsers/edge.svg?react";
import Firefox from "./browsers/firefox.svg?react";
import Vivaldi from "./browsers/vivaldi.svg?react";

// Shells - bare ids matching daemon where SVG exists
import Bash from "./shells/bash.svg?react";
import Fish from "./shells/fish.svg?react";
import NuShell from "./shells/nushell.svg?react";
import Pwsh from "./shells/pwsh.svg?react";
import Zsh from "./shells/zsh.svg?react";

// Lucide fallbacks for generics
const generic: Partial<Record<RegistryKind, React.ComponentType<React.SVGProps<SVGSVGElement> | { size?: number | string }>>> = {
  shell: TerminalSquare,
  agent: Bot,
  ide: Code2,
  "file-explorer": FolderOpen,
  browser: Globe
};

const ClineIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <img src={Cline} width={props.width} height={props.height} className={props.className} style={props.style} alt="" />
);
const KimiIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <img src={Kimi} width={props.width} height={props.height} className={props.className} style={props.style} alt="" />
);

const specific: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  // agents (bare ids)
  claude: Claude,
  codex: Codex,
  cline: ClineIcon,
  deepseek: DeepSeek,
  deepcode: DeepSeek,
  gemini: Gemini,
  grok: Grok,
  kimi: KimiIcon,
  opencode: OpenCode,

  // ides (bare ids from daemon + jetbrains from user SVGs)
  vscode: VSCode,
  cursor: Cursor,
  antigravity: Antigravity,
  windsurf: Windsurf,
  zed: Zed,
  intellij: IntelliJ,
  sublime: Sublime,
  clion: CLion,
  goland: GoLand,
  phpstorm: PhpStorm,
  pycharm: PyCharm,
  rustrover: RustRover,

  // explorers (only existing SVGs; system-files falls back or maps if present)
  dolphin: Dolphin,
  thunar: Thunar,
  explorer: Explorer,
  "system-files": Explorer,

  // browsers
  chrome: Chrome,
  chromium: Chromium,
  firefox: Firefox,
  brave: Brave,
  edge: Edge,
  vivaldi: Vivaldi,

  // shells (bare, matching daemon ids that have SVGs)
  bash: Bash,
  zsh: Zsh,
  fish: Fish,
  nu: NuShell,
  pwsh: Pwsh
};

export function getRegistryIcon(
  kind: RegistryKind,
  refId?: string,
  size: number | string = 14
): React.ReactNode {
  if (refId) {
    const Comp = specific[refId];
    if (Comp) {
      return React.createElement(Comp, { width: size, height: size });
    }
  }
  const Gen = generic[kind];
  if (Gen) {
    return React.createElement(Gen, { size });
  }
  return null;
}

export function RegistryIcon({
  kind,
  refId,
  size = 14
}: {
  kind: RegistryKind;
  refId?: string;
  size?: number | string;
}) {
  return <>{getRegistryIcon(kind, refId, size)}</>;
}
