import type { RegistryKind } from "@orquester/api";
import { AGENT_DEFS } from "./agents";

export type { RegistryKind };

export interface RegistryEntryDef {
  id: string;
  name: string;
  kind: RegistryKind;
  /** bin candidates. May use tokens: $LOCALAPPDATA, $PROGRAMFILES, $HOME */
  bin: readonly string[];
  versionFlag?: string;
  installCmd?: string;
  updateCmd?: string;
}

/**
 * Single source of truth.
 * Pure static data. No logic, no env evaluation here.
 */
export const REGISTRY = {
  shells: [
    { id: "bash", name: "Bash", kind: "shell", bin: ["bash"] as const },
    { id: "zsh", name: "Zsh", kind: "shell", bin: ["zsh"] as const },
    { id: "fish", name: "Fish", kind: "shell", bin: ["fish"] as const },
    { id: "nu", name: "Nushell", kind: "shell", bin: ["nu"] as const },
    { id: "pwsh", name: "PowerShell", kind: "shell", bin: ["pwsh", "powershell"] as const },
    { id: "cmd", name: "Command Prompt", kind: "shell", bin: ["cmd"] as const },
    { id: "sh", name: "sh", kind: "shell", bin: ["sh"] as const }
  ] as const,

  agents: AGENT_DEFS,

  ides: [
    {
      id: "vscode",
      name: "VS Code",
      kind: "ide",
      bin: [
        "code",
        "code-insiders",
        "/usr/bin/code",
        "/usr/share/code/bin/code",
        "/snap/bin/code",
        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        "$LOCALAPPDATA\\Programs\\Microsoft VS Code\\bin\\code.cmd",
        "$PROGRAMFILES\\Microsoft VS Code\\bin\\code.cmd"
      ] as const
    },
    {
      id: "cursor",
      name: "Cursor",
      kind: "ide",
      bin: [
        "cursor",
        "/usr/bin/cursor",
        "/usr/share/cursor/bin/cursor",
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        "$LOCALAPPDATA\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd"
      ] as const
    },
    {
      id: "antigravity",
      name: "Antigravity",
      kind: "ide",
      bin: [
        "antigravity",
        "/usr/bin/antigravity",
        "/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity",
        "$LOCALAPPDATA\\Programs\\Antigravity\\bin\\antigravity.cmd"
      ] as const
    },
    {
      id: "windsurf",
      name: "Windsurf",
      kind: "ide",
      bin: ["windsurf", "/usr/bin/windsurf", "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"] as const
    },
    {
      id: "zed",
      name: "Zed",
      kind: "ide",
      bin: ["zed", "zeditor", "/usr/bin/zed", "/Applications/Zed.app/Contents/MacOS/cli"] as const
    },
    {
      id: "intellij",
      name: "IntelliJ IDEA",
      kind: "ide",
      bin: ["idea", "idea.sh", "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea"] as const
    },
    {
      id: "sublime",
      name: "Sublime Text",
      kind: "ide",
      bin: ["subl", "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"] as const
    },
    {
      id: "clion",
      name: "CLion",
      kind: "ide",
      bin: ["clion", "/Applications/CLion.app/Contents/MacOS/clion"] as const
    },
    {
      id: "goland",
      name: "GoLand",
      kind: "ide",
      bin: ["goland", "/Applications/GoLand.app/Contents/MacOS/goland"] as const
    },
    {
      id: "phpstorm",
      name: "PhpStorm",
      kind: "ide",
      bin: ["phpstorm", "/Applications/PhpStorm.app/Contents/MacOS/phpstorm"] as const
    },
    {
      id: "pycharm",
      name: "PyCharm",
      kind: "ide",
      bin: ["pycharm", "/Applications/PyCharm.app/Contents/MacOS/pycharm"] as const
    },
    {
      id: "rustrover",
      name: "RustRover",
      kind: "ide",
      bin: ["rustrover", "/Applications/RustRover.app/Contents/MacOS/rustrover"] as const
    }
  ] as const,

  fileExplorers: [
    { id: "nautilus", name: "Files (Nautilus)", kind: "file-explorer", bin: ["nautilus"] as const },
    { id: "dolphin", name: "Dolphin", kind: "file-explorer", bin: ["dolphin"] as const },
    { id: "thunar", name: "Thunar", kind: "file-explorer", bin: ["thunar"] as const },
    { id: "nemo", name: "Nemo", kind: "file-explorer", bin: ["nemo"] as const },
    { id: "pcmanfm", name: "PCManFM", kind: "file-explorer", bin: ["pcmanfm"] as const },
    { id: "caja", name: "Caja", kind: "file-explorer", bin: ["caja"] as const },
    { id: "explorer", name: "Explorer", kind: "file-explorer", bin: ["explorer"] as const },
    { id: "system-files", name: "Open Directory", kind: "file-explorer", bin: [] as const }
  ] as const,

  browsers: [
    {
      id: "chrome",
      name: "Google Chrome",
      kind: "browser",
      bin: [
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe"
      ] as const
    },
    { id: "chromium", name: "Chromium", kind: "browser", bin: ["chromium", "chromium-browser"] as const },
    {
      id: "firefox",
      name: "Firefox",
      kind: "browser",
      bin: ["firefox", "/Applications/Firefox.app/Contents/MacOS/firefox", "$PROGRAMFILES\\Mozilla Firefox\\firefox.exe"] as const
    },
    {
      id: "brave",
      name: "Brave",
      kind: "browser",
      bin: ["brave-browser", "brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] as const
    },
    {
      id: "edge",
      name: "Microsoft Edge",
      kind: "browser",
      bin: [
        "microsoft-edge",
        "microsoft-edge-stable",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "$PROGRAMFILES\\Microsoft Edge\\Application\\msedge.exe"
      ] as const
    },
    { id: "vivaldi", name: "Vivaldi", kind: "browser", bin: ["vivaldi", "vivaldi-stable"] as const },
    { id: "system-browser", name: "Default Browser", kind: "browser", bin: [] as const }
  ] as const
} as const;
