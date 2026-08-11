import type { RegistryEntryDef } from "@orquester/registry";

export const HOST_IDES: readonly RegistryEntryDef[] = [
  { id: "vscode", name: "VS Code", kind: "ide", bin: ["code", "code-insiders", "/usr/bin/code", "/usr/share/code/bin/code", "/snap/bin/code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "$LOCALAPPDATA\\Programs\\Microsoft VS Code\\bin\\code.cmd", "$PROGRAMFILES\\Microsoft VS Code\\bin\\code.cmd"] },
  { id: "cursor", name: "Cursor", kind: "ide", bin: ["cursor", "/usr/bin/cursor", "/usr/share/cursor/bin/cursor", "/Applications/Cursor.app/Contents/Resources/app/bin/cursor", "$LOCALAPPDATA\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd"] },
  { id: "windsurf", name: "Windsurf", kind: "ide", bin: ["windsurf", "/usr/bin/windsurf", "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"] },
  { id: "zed", name: "Zed", kind: "ide", bin: ["zed", "zeditor", "/usr/bin/zed", "/Applications/Zed.app/Contents/MacOS/cli"] },
  { id: "intellij", name: "IntelliJ IDEA", kind: "ide", bin: ["idea", "idea.sh", "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea"] },
  { id: "sublime", name: "Sublime Text", kind: "ide", bin: ["subl", "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"] },
  { id: "clion", name: "CLion", kind: "ide", bin: ["clion", "/Applications/CLion.app/Contents/MacOS/clion"] },
  { id: "goland", name: "GoLand", kind: "ide", bin: ["goland", "/Applications/GoLand.app/Contents/MacOS/goland"] },
  { id: "phpstorm", name: "PhpStorm", kind: "ide", bin: ["phpstorm", "/Applications/PhpStorm.app/Contents/MacOS/phpstorm"] },
  { id: "pycharm", name: "PyCharm", kind: "ide", bin: ["pycharm", "/Applications/PyCharm.app/Contents/MacOS/pycharm"] },
  { id: "rustrover", name: "RustRover", kind: "ide", bin: ["rustrover", "/Applications/RustRover.app/Contents/MacOS/rustrover"] }
];

export const HOST_FILE_EXPLORERS: readonly RegistryEntryDef[] = [
  { id: "nautilus", name: "Files (Nautilus)", kind: "file-explorer", bin: ["nautilus"] },
  { id: "dolphin", name: "Dolphin", kind: "file-explorer", bin: ["dolphin"] },
  { id: "thunar", name: "Thunar", kind: "file-explorer", bin: ["thunar"] },
  { id: "nemo", name: "Nemo", kind: "file-explorer", bin: ["nemo"] },
  { id: "pcmanfm", name: "PCManFM", kind: "file-explorer", bin: ["pcmanfm"] },
  { id: "caja", name: "Caja", kind: "file-explorer", bin: ["caja"] },
  { id: "explorer", name: "Explorer", kind: "file-explorer", bin: ["explorer"] },
  { id: "system-files", name: "Open Directory", kind: "file-explorer", bin: [] }
];

export const HOST_BROWSERS: readonly RegistryEntryDef[] = [
  { id: "chrome", name: "Google Chrome", kind: "browser", bin: ["google-chrome", "google-chrome-stable", "chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe"] },
  { id: "chromium", name: "Chromium", kind: "browser", bin: ["chromium", "chromium-browser"] },
  { id: "firefox", name: "Firefox", kind: "browser", bin: ["firefox", "/Applications/Firefox.app/Contents/MacOS/firefox", "$PROGRAMFILES\\Mozilla Firefox\\firefox.exe"] },
  { id: "brave", name: "Brave", kind: "browser", bin: ["brave-browser", "brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] },
  { id: "edge", name: "Microsoft Edge", kind: "browser", bin: ["microsoft-edge", "microsoft-edge-stable", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "$PROGRAMFILES\\Microsoft Edge\\Application\\msedge.exe"] },
  { id: "vivaldi", name: "Vivaldi", kind: "browser", bin: ["vivaldi", "vivaldi-stable"] },
  { id: "system-browser", name: "Default Browser", kind: "browser", bin: [] }
];
