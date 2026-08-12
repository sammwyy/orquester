use super::AgentDef;

pub const DEF: AgentDef = AgentDef {
    id: "cline",
    name: "Cline",
    bin: &["cline"],
    bin_deps: &["npm"],
    version_flag: "--version",
    install_cmd: "npm i -g cline",
    update_cmd: "npm i -g cline",
    website_url: "https://cline.bot/",
};
