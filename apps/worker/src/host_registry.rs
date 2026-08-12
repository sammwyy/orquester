//! Static IDE, file
//! explorer and browser candidates by platform, before PATH/env resolution.

pub struct HostEntryDef {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static [&'static str],
}

pub const HOST_IDES: &[HostEntryDef] = &[
    HostEntryDef { id: "vscode", name: "VS Code", bin: &["code", "code-insiders", "/usr/bin/code", "/usr/share/code/bin/code", "/snap/bin/code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", "$LOCALAPPDATA\\Programs\\Microsoft VS Code\\bin\\code.cmd", "$PROGRAMFILES\\Microsoft VS Code\\bin\\code.cmd"] },
    HostEntryDef { id: "cursor", name: "Cursor", bin: &["cursor", "/usr/bin/cursor", "/usr/share/cursor/bin/cursor", "/Applications/Cursor.app/Contents/Resources/app/bin/cursor", "$LOCALAPPDATA\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd"] },
    HostEntryDef { id: "windsurf", name: "Windsurf", bin: &["windsurf", "/usr/bin/windsurf", "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"] },
    HostEntryDef { id: "zed", name: "Zed", bin: &["zed", "zeditor", "/usr/bin/zed", "/Applications/Zed.app/Contents/MacOS/cli"] },
    HostEntryDef { id: "intellij", name: "IntelliJ IDEA", bin: &["idea", "idea.sh", "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea"] },
    HostEntryDef { id: "sublime", name: "Sublime Text", bin: &["subl", "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"] },
    HostEntryDef { id: "clion", name: "CLion", bin: &["clion", "/Applications/CLion.app/Contents/MacOS/clion"] },
    HostEntryDef { id: "goland", name: "GoLand", bin: &["goland", "/Applications/GoLand.app/Contents/MacOS/goland"] },
    HostEntryDef { id: "phpstorm", name: "PhpStorm", bin: &["phpstorm", "/Applications/PhpStorm.app/Contents/MacOS/phpstorm"] },
    HostEntryDef { id: "pycharm", name: "PyCharm", bin: &["pycharm", "/Applications/PyCharm.app/Contents/MacOS/pycharm"] },
    HostEntryDef { id: "rustrover", name: "RustRover", bin: &["rustrover", "/Applications/RustRover.app/Contents/MacOS/rustrover"] },
];

pub const HOST_FILE_EXPLORERS: &[HostEntryDef] = &[
    HostEntryDef { id: "nautilus", name: "Files (Nautilus)", bin: &["nautilus"] },
    HostEntryDef { id: "dolphin", name: "Dolphin", bin: &["dolphin"] },
    HostEntryDef { id: "thunar", name: "Thunar", bin: &["thunar"] },
    HostEntryDef { id: "nemo", name: "Nemo", bin: &["nemo"] },
    HostEntryDef { id: "pcmanfm", name: "PCManFM", bin: &["pcmanfm"] },
    HostEntryDef { id: "caja", name: "Caja", bin: &["caja"] },
    HostEntryDef { id: "explorer", name: "Explorer", bin: &["explorer"] },
    HostEntryDef { id: "system-files", name: "Open Directory", bin: &[] },
];

pub const HOST_BROWSERS: &[HostEntryDef] = &[
    HostEntryDef { id: "chrome", name: "Google Chrome", bin: &["google-chrome", "google-chrome-stable", "chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe"] },
    HostEntryDef { id: "chromium", name: "Chromium", bin: &["chromium", "chromium-browser"] },
    HostEntryDef { id: "firefox", name: "Firefox", bin: &["firefox", "/Applications/Firefox.app/Contents/MacOS/firefox", "$PROGRAMFILES\\Mozilla Firefox\\firefox.exe"] },
    HostEntryDef { id: "brave", name: "Brave", bin: &["brave-browser", "brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] },
    HostEntryDef { id: "edge", name: "Microsoft Edge", bin: &["microsoft-edge", "microsoft-edge-stable", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "$PROGRAMFILES\\Microsoft Edge\\Application\\msedge.exe"] },
    HostEntryDef { id: "vivaldi", name: "Vivaldi", bin: &["vivaldi", "vivaldi-stable"] },
    HostEntryDef { id: "system-browser", name: "Default Browser", bin: &[] },
];
