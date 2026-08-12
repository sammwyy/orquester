//! Static agent catalog — the `id`/`bin`/`versionFlag`/`installCmd` half of
//! Each agent's bespoke quota/auth
//! logic (getQuota/getAuthStatus, scraping CLI or local-API output) is NOT
//! ported: it's a large, provider-specific body of work on its own. Agents
//! resolve, launch as PTY sessions, and report their version here; quota and
//! install/update stay behind the same honest NOT_IMPLEMENTED as the rest of
//! the registry routes until that follow-up lands.

pub struct AgentDef {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static [&'static str],
    pub bin_deps: &'static [&'static str],
    pub version_flag: &'static str,
    pub install_cmd: &'static str,
    pub update_cmd: &'static str,
    pub website_url: &'static str,
}

pub const AGENT_DEFS: &[AgentDef] = &[
    AgentDef {
        id: "antigravity",
        name: "Antigravity",
        bin: &["agy"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "powershell -NoProfile -Command \"irm https://antigravity.google/cli/install.ps1 | iex\"",
        update_cmd: "agy update",
        website_url: "https://antigravity.google/",
    },
    AgentDef {
        id: "claude",
        name: "Claude Code",
        bin: &["claude"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "npm install -g @anthropic-ai/claude-code",
        update_cmd: "npm update -g @anthropic-ai/claude-code",
        website_url: "https://www.anthropic.com/claude-code",
    },
    AgentDef {
        id: "cline",
        name: "Cline",
        bin: &["cline"],
        bin_deps: &["npm"],
        version_flag: "--version",
        install_cmd: "npm i -g cline",
        update_cmd: "npm i -g cline",
        website_url: "https://cline.bot/",
    },
    AgentDef {
        id: "codex",
        name: "Codex",
        bin: &["codex"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "npm install -g @openai/codex",
        update_cmd: "npm update -g @openai/codex",
        website_url: "https://openai.com/codex/",
    },
    AgentDef {
        id: "deepcode",
        name: "Deep Code",
        bin: &["deepcode"],
        bin_deps: &["npm"],
        version_flag: "--version",
        install_cmd: "npm install -g @vegamo/deepcode-cli",
        update_cmd: "npm install -g @vegamo/deepcode-cli",
        website_url: "https://github.com/lessweb/deepcode-cli",
    },
    AgentDef {
        id: "grok",
        name: "Grok Build",
        bin: &["grok"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
        update_cmd: "grok update",
        website_url: "https://x.ai/",
    },
    AgentDef {
        id: "kimi",
        name: "Kimi Code",
        bin: &["kimi"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "powershell -NoProfile -Command \"irm https://code.kimi.com/kimi-code/install.ps1 | iex\"",
        update_cmd: "kimi upgrade",
        website_url: "https://code.kimi.com/",
    },
    AgentDef {
        id: "opencode",
        name: "OpenCode",
        bin: &["opencode"],
        bin_deps: &[],
        version_flag: "--version",
        install_cmd: "npm install -g opencode-ai",
        update_cmd: "npm update -g opencode-ai",
        website_url: "https://opencode.ai/",
    },
];
