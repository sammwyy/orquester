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

/// `--appdir <path>` or `--appdir=<path>` from CLI args, resolved against cwd.
pub fn parse_appdir(args: &[String], cwd: &std::path::Path) -> Option<String> {
    let raw = args.iter().find_map(|arg| arg.strip_prefix("--appdir=").map(str::to_string)).or_else(|| {
        args.iter()
            .position(|arg| arg == "--appdir")
            .and_then(|index| args.get(index + 1))
            .cloned()
    })?;
    Some(cwd.join(&raw).to_string_lossy().to_string())
}
