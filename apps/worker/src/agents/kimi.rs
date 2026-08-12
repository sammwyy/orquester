use super::AgentDef;

pub const DEF: AgentDef = AgentDef {
    id: "kimi",
    name: "Kimi Code",
    bin: &["kimi"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "powershell -NoProfile -Command \"irm https://code.kimi.com/kimi-code/install.ps1 | iex\"",
    update_cmd: "kimi upgrade",
    website_url: "https://code.kimi.com/",
};
