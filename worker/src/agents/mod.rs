//! Agent catalog and per-provider quota/auth support. Each submodule owns one
//! provider's static `AgentDef` (id/bin/versionFlag/installCmd/...) plus its
//! bespoke quota/auth-status scraping, where ported. Every agent's getVersion
//! is just `ctx.call(["--version"])` + first-line, already covered generically
//! by RegistryService::version — no per-agent override needed there.
//!
//! Ported: claude (auth status + usage text scraping), antigravity (usage text
//! scraping, same shape as claude), codex (JSON-RPC over the `codex
//! app-server` stdio protocol), and grok (drives an interactive PTY session,
//! waits for a regex stop-condition, then sends Ctrl+C). cline, deepcode,
//! kimi and opencode have no quota/auth integration — same as the TS worker,
//! their quota calls are a literal `unsupportedQuota(...)`.

mod antigravity;
mod claude;
mod cline;
mod codex;
mod deepcode;
mod grok;
mod kimi;
mod opencode;
mod support;

use crate::api_types::{AgentConversationSummary, RegistryAuthInfo, RegistryQuota};
use std::path::Path;

pub use support::unsupported_quota;

pub struct AgentDef {
    pub id: &'static str,
    pub name: &'static str,
    pub bin: &'static [&'static str],
    pub bin_deps: &'static [&'static str],
    pub version_flag: &'static str,
    pub install_cmd: &'static str,
    pub update_cmd: &'static str,
    pub website_url: &'static str,
    /// CLI args that resume a past conversation, `{id}` standing in for the
    /// conversation id — empty when this agent has no known resume flag yet.
    pub resume_args: &'static [&'static str],
}

pub const AGENT_DEFS: &[AgentDef] = &[
    antigravity::DEF,
    claude::DEF,
    cline::DEF,
    codex::DEF,
    deepcode::DEF,
    grok::DEF,
    kimi::DEF,
    opencode::DEF,
];

/// CLI args to resume `conversation_id` for agent `id`, or empty if it has
/// no known resume flag (or isn't an agent at all — e.g. a shell).
pub fn resume_args(id: &str, conversation_id: &str) -> Vec<String> {
    AGENT_DEFS
        .iter()
        .find(|def| def.id == id)
        .map(|def| def.resume_args.iter().map(|arg| arg.replace("{id}", conversation_id)).collect())
        .unwrap_or_default()
}

pub async fn get_auth_status(id: &str, bin: &Path) -> Option<RegistryAuthInfo> {
    match id {
        "claude" => Some(claude::auth_status(bin).await),
        "codex" => Some(codex::auth_status(bin).await),
        "grok" => Some(grok::auth_status(bin).await),
        // A readable antigravity usage response means the CLI has an active
        // session — see antigravity::quota, which sets this same status.
        _ => None,
    }
}

/// Past conversations for `id` scoped to `project_path`, newest first.
/// Silently empty for any provider without a known history format —
/// deepcode isn't installed anywhere to verify one exists.
pub async fn list_conversations(id: &str, project_path: &str) -> Vec<AgentConversationSummary> {
    match id {
        "claude" => claude::list_conversations(project_path).await,
        "codex" => codex::list_conversations(project_path).await,
        "grok" => grok::list_conversations(project_path).await,
        "kimi" => kimi::list_conversations(project_path).await,
        "opencode" => opencode::list_conversations(project_path).await,
        "cline" => cline::list_conversations(project_path).await,
        "antigravity" => antigravity::list_conversations(project_path).await,
        _ => Vec::new(),
    }
}

pub async fn get_quota(id: &str, bin: &Path, name: &str) -> RegistryQuota {
    match id {
        "claude" => claude::quota(bin, name).await,
        "antigravity" => antigravity::quota(bin, name).await,
        "codex" => codex::quota(bin, name).await,
        "grok" => grok::quota(bin, name).await,
        // Trivial in the TS worker too (agent-{cline,deepcode,kimi,opencode}.ts
        // all just return unsupportedQuota with these exact messages).
        "kimi" => unsupported_quota(id, name, Some("Kimi usage is not configured for this integration yet.")),
        "opencode" => unsupported_quota(id, name, Some("Quota is not supported by OpenCode yet.")),
        "cline" | "deepcode" => unsupported_quota(id, name, None),
        _ => unsupported_quota(id, name, None),
    }
}
