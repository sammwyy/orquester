//! Resolves on-disk locations for a single worker run (mirrors the
//! `ResolvedPaths` object built in apps/daemon/src/index.ts).

use crate::config::{self, ConfigVars};
use std::collections::HashMap;

pub struct ResolvedPaths {
    pub daemon_dir: String,
    pub config_path: String,
    pub app_config_file: String,
    pub remotes_file: String,
    pub workspaces_dir: String,
    pub logs_dir: String,
    pub vars: ConfigVars,
}

pub fn resolve(
    home_dir: &str,
    platform: &str,
    cwd: &str,
    appdir: Option<&str>,
    env: &HashMap<String, String>,
    daemon_config: &config::DaemonConfig,
) -> ResolvedPaths {
    let paths = config::resolve_daemon_paths(config::ResolveDaemonPathsInput {
        home_dir,
        platform,
        cwd,
        appdir,
        env,
    });

    ResolvedPaths {
        app_config_file: config::app_config_path(&paths.base_dir),
        remotes_file: config::remotes_config_path(&paths.base_dir),
        workspaces_dir: config::expand_vars(&daemon_config.workspaces_dir, &paths.vars),
        logs_dir: config::expand_vars(&daemon_config.logs_dir, &paths.vars),
        daemon_dir: paths.daemon_dir,
        config_path: paths.config_path,
        vars: paths.vars,
    }
}

/// `--appdir <path>` or `--appdir=<path>` from CLI args (raw, not yet
/// resolved against cwd — see `resolve_appdir`).
pub fn parse_appdir_arg(args: &[String]) -> Option<String> {
    args.iter().find_map(|arg| arg.strip_prefix("--appdir=").map(str::to_string)).or_else(|| {
        args.iter()
            .position(|arg| arg == "--appdir")
            .and_then(|index| args.get(index + 1))
            .cloned()
    })
}

/// Lexical equivalent of Node's `path.resolve` — normalizes `.`/`..` and
/// makes the path absolute (against `base` when relative) without touching
/// the filesystem. Deliberately not `fs::canonicalize`: that resolves
/// symlinks and, on Windows, prefixes the result with `\\?\`.
pub fn lexical_resolve(base: &std::path::Path, path: &str) -> std::path::PathBuf {
    let candidate = std::path::PathBuf::from(path);
    let absolute = if candidate.is_absolute() { candidate } else { base.join(candidate) };
    let mut normalized = std::path::PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// Resolve a (possibly relative) appdir to an absolute path, or None.
/// Mirrors `resolveAppdir` in apps/daemon/src/index.ts — every appdir
/// source (CLI flag or env var) goes through this same cwd-relative
/// resolution, not just one of them.
pub fn resolve_appdir(raw: Option<&str>, cwd: &std::path::Path) -> Option<String> {
    let raw = raw.filter(|r| !r.is_empty())?;
    Some(lexical_resolve(cwd, raw).to_string_lossy().to_string())
}
