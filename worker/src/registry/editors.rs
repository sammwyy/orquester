use super::HostEntryDef;

pub const EDITORS: &[HostEntryDef] = &[
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
