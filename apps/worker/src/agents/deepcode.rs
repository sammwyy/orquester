use super::AgentDef;

pub const DEF: AgentDef = AgentDef {
    id: "deepcode",
    name: "Deep Code",
    bin: &["deepcode"],
    bin_deps: &["npm"],
    version_flag: "--version",
    install_cmd: "npm install -g @vegamo/deepcode-cli",
    update_cmd: "npm install -g @vegamo/deepcode-cli",
    website_url: "https://github.com/lessweb/deepcode-cli",
};
