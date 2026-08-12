use super::HostEntryDef;

pub const BROWSERS: &[HostEntryDef] = &[
    HostEntryDef { id: "chrome", name: "Google Chrome", bin: &["google-chrome", "google-chrome-stable", "chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "$PROGRAMFILES\\Google\\Chrome\\Application\\chrome.exe"] },
    HostEntryDef { id: "chromium", name: "Chromium", bin: &["chromium", "chromium-browser"] },
    HostEntryDef { id: "firefox", name: "Firefox", bin: &["firefox", "/Applications/Firefox.app/Contents/MacOS/firefox", "$PROGRAMFILES\\Mozilla Firefox\\firefox.exe"] },
    HostEntryDef { id: "brave", name: "Brave", bin: &["brave-browser", "brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"] },
    HostEntryDef { id: "edge", name: "Microsoft Edge", bin: &["microsoft-edge", "microsoft-edge-stable", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "$PROGRAMFILES\\Microsoft Edge\\Application\\msedge.exe"] },
    HostEntryDef { id: "vivaldi", name: "Vivaldi", bin: &["vivaldi", "vivaldi-stable"] },
    HostEntryDef { id: "system-browser", name: "Default Browser", bin: &[] },
];
