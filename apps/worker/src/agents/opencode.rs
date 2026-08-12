use super::AgentDef;

pub const DEF: AgentDef = AgentDef {
    id: "opencode",
    name: "OpenCode",
    bin: &["opencode"],
    bin_deps: &[],
    version_flag: "--version",
    install_cmd: "npm install -g opencode-ai",
    update_cmd: "npm update -g opencode-ai",
    website_url: "https://opencode.ai/",
};
