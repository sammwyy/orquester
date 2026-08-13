//! Git integration. Shells
//! out to the real `git` binary exactly like the TS worker did (no libgit2),
//! so behavior — including error messages surfaced to the client — matches.

use crate::api_types::{
    GitBranchSummary, GitBranchesResponse, GitCommitDetail, GitCommitFile, GitCommitLine, GitCommitSummary,
    GitFileStatus, GitLogResponse, GitStashSummary, GitStatusResponse,
};
use std::path::Path;
use tokio::process::Command;

pub async fn is_git_available() -> bool {
    Command::new("git").arg("--version").output().await.map(|o| o.status.success()).unwrap_or(false)
}

fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

async fn git(project_path: &str, args: &[&str]) -> std::io::Result<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(project_path).args(args);
    hide_console_window(&mut command);
    let output = command.output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(std::io::Error::other(if stderr.is_empty() { "git command failed".to_string() } else { stderr }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn assert_project_repository(project_path: &str) -> std::io::Result<()> {
    tokio::fs::metadata(Path::new(project_path).join(".git")).await.map(|_| ())
}

/// Splits `-z` output on NUL and drops the single trailing empty element
/// left by the terminator on the last record.
fn nul_tokens(output: &str) -> Vec<&str> {
    let mut tokens: Vec<&str> = output.split('\0').collect();
    if tokens.last() == Some(&"") {
        tokens.pop();
    }
    tokens
}

/// Parses `git status --porcelain=v1 -z` output.
/// Plain (non-`-z`) porcelain quotes/escapes paths with spaces, unicode or
/// backslashes, and renders renames as a single `"old" -> "new"` string —
/// both unusable as a pathspec for follow-up commands. `-z` sidesteps both:
/// paths are raw bytes, and a rename is two consecutive NUL-terminated
/// records (new path, then original path).
fn parse_status_entries(output: &str) -> Vec<GitFileStatus> {
    let tokens = nul_tokens(output);
    let mut files = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let entry = tokens[i];
        i += 1;
        if entry.len() < 3 {
            continue;
        }
        let status = entry[..2].to_string();
        let path = entry[3..].to_string();
        let is_rename_or_copy = status.as_bytes().iter().any(|b| *b == b'R' || *b == b'C');
        if is_rename_or_copy && i < tokens.len() {
            i += 1; // original path, before the rename — not currently surfaced
        }
        files.push(GitFileStatus { status, path });
    }
    files
}

/// Parses `git diff --name-status -z` (old path then new path for renames,
/// the opposite order from status `-z`) into a path -> status-code map.
fn parse_name_status_map(output: &str) -> std::collections::HashMap<String, String> {
    let tokens = nul_tokens(output);
    let mut map = std::collections::HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        let status = tokens[i].to_string();
        i += 1;
        let is_rename_or_copy = status.starts_with('R') || status.starts_with('C');
        let path = if is_rename_or_copy {
            let _old = tokens.get(i).copied().unwrap_or("");
            i += 1;
            let new = tokens.get(i).copied().unwrap_or("").to_string();
            i += 1;
            new
        } else {
            let path = tokens.get(i).copied().unwrap_or("").to_string();
            i += 1;
            path
        };
        map.insert(path, status);
    }
    map
}

/// Parses `git diff --numstat -z`: a normal record is `add\tdel\tpath`; a
/// renamed file has an empty path field followed by two more NUL records
/// (old path, new path).
fn parse_numstat_entries(output: &str) -> Vec<(i64, i64, String)> {
    let tokens = nul_tokens(output);
    let mut entries = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let entry = tokens[i];
        i += 1;
        let mut parts = entry.splitn(3, '\t');
        let additions = parts.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
        let deletions = parts.next().unwrap_or("0").parse::<i64>().unwrap_or(0);
        let inline_path = parts.next().unwrap_or("");
        let path = if inline_path.is_empty() {
            let _old = tokens.get(i).copied().unwrap_or("");
            i += 1;
            let new = tokens.get(i).copied().unwrap_or("").to_string();
            i += 1;
            new
        } else {
            inline_path.to_string()
        };
        entries.push((additions, deletions, path));
    }
    entries
}

pub async fn initialize_git(project_path: &str) -> std::io::Result<GitStatusResponse> {
    let mut command = Command::new("git");
    command.arg("-C").arg(project_path).arg("init");
    hide_console_window(&mut command);
    command.output().await?;
    read_git_status(project_path).await
}

pub async fn read_git_status(project_path: &str) -> std::io::Result<GitStatusResponse> {
    assert_project_repository(project_path).await?;
    let branch = git(project_path, &["branch", "--show-current"]).await?.trim().to_string();
    let branch = if branch.is_empty() { "HEAD".to_string() } else { branch };
    let origin = git(project_path, &["remote", "get-url", "origin"]).await.unwrap_or_default();
    let log_output = git(project_path, &["log", "-5", "--format=%H%x09%an%x09%aI%x09%s"]).await.unwrap_or_default();
    let files_output = git(project_path, &["status", "--porcelain=v1", "-z"]).await.unwrap_or_default();
    let diff_output = git(project_path, &["diff", "--numstat", "-z", "HEAD"]).await.unwrap_or_default();

    let mut additions = 0i64;
    let mut deletions = 0i64;
    for (a, d, _) in parse_numstat_entries(&diff_output) {
        additions += a;
        deletions += d;
    }

    let commits = log_output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let mut fields = line.splitn(4, '\t');
            let hash = fields.next().unwrap_or("").to_string();
            let author = fields.next().unwrap_or("").to_string();
            let date = fields.next().unwrap_or("").to_string();
            let subject = fields.next().unwrap_or("").to_string();
            GitCommitLine { hash, author, date, subject }
        })
        .collect();

    let files = parse_status_entries(&files_output);

    Ok(GitStatusResponse {
        project_path: project_path.to_string(),
        branch,
        origin: { let o = origin.trim().to_string(); if o.is_empty() { None } else { Some(o) } },
        additions,
        deletions,
        commits,
        files,
    })
}

const FIELD_SEP: &str = "\u{1f}";
const RECORD_SEP: &str = "\u{1e}";

async fn current_head_info(project_path: &str) -> (Option<String>, Option<String>) {
    match git(project_path, &["symbolic-ref", "-q", "--short", "HEAD"]).await {
        Ok(branch) => {
            let branch = branch.trim().to_string();
            (if branch.is_empty() { None } else { Some(branch) }, None)
        }
        Err(_) => {
            let hash = git(project_path, &["rev-parse", "HEAD"]).await.unwrap_or_default().trim().to_string();
            (None, if hash.is_empty() { None } else { Some(hash) })
        }
    }
}

fn parse_track(track: &str) -> (u32, u32) {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| regex::Regex::new(r"ahead (\d+)|behind (\d+)").unwrap());
    let mut ahead = 0;
    let mut behind = 0;
    for capture in pattern.captures_iter(track) {
        if let Some(m) = capture.get(1) {
            ahead = m.as_str().parse().unwrap_or(0);
        }
        if let Some(m) = capture.get(2) {
            behind = m.as_str().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

pub async fn list_branches(project_path: &str) -> std::io::Result<GitBranchesResponse> {
    assert_project_repository(project_path).await?;
    let format = format!(
        "%(refname){FIELD_SEP}%(refname:short){FIELD_SEP}%(objectname){FIELD_SEP}%(upstream:short){FIELD_SEP}%(HEAD){FIELD_SEP}%(upstream:track)"
    );
    let format_arg = format!("--format={format}");
    let local_out = git(project_path, &["for-each-ref", "refs/heads", &format_arg]).await.unwrap_or_default();
    let remote_out = git(project_path, &["for-each-ref", "refs/remotes", &format_arg]).await.unwrap_or_default();
    let (current_branch, detached_at) = current_head_info(project_path).await;

    let parse_refs = |output: &str, remote: bool| -> Vec<GitBranchSummary> {
        output
            .lines()
            .filter(|l| !l.is_empty())
            .filter(|line| !line.split(FIELD_SEP).next().unwrap_or("").ends_with("/HEAD"))
            .map(|line| {
                let mut fields = line.split(FIELD_SEP);
                let _refname = fields.next().unwrap_or("");
                let name = fields.next().unwrap_or("").to_string();
                let commit_hash = fields.next().unwrap_or("").to_string();
                let upstream = fields.next().unwrap_or("").to_string();
                let head_marker = fields.next().unwrap_or("");
                let track = fields.next().unwrap_or("");
                let (ahead, behind) = parse_track(track);
                GitBranchSummary {
                    name,
                    remote,
                    current: !remote && head_marker == "*",
                    commit_hash,
                    upstream: if upstream.is_empty() { None } else { Some(upstream) },
                    ahead,
                    behind,
                }
            })
            .collect()
    };

    let mut branches = parse_refs(&local_out, false);
    branches.extend(parse_refs(&remote_out, true));
    Ok(GitBranchesResponse { branches, current_branch, detached_at })
}

pub async fn read_log(project_path: &str, branch: Option<&str>, limit: usize, skip: usize) -> std::io::Result<GitLogResponse> {
    assert_project_repository(project_path).await?;
    let format = format!("%H{FIELD_SEP}%P{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%aI{FIELD_SEP}%D{FIELD_SEP}%s{RECORD_SEP}");
    let format_arg = format!("--format={format}");
    let branch_arg = branch.filter(|b| !b.is_empty()).unwrap_or("--all");
    let limit_count = (limit + 1).to_string();
    let skip_arg = format!("--skip={skip}");
    let output = git(project_path, &["log", branch_arg, &format_arg, "-n", &limit_count, &skip_arg]).await.unwrap_or_default();

    let records: Vec<&str> = output.split(RECORD_SEP).map(|r| r.trim()).filter(|r| !r.is_empty()).collect();
    let has_more = records.len() > limit;
    let commits = records
        .into_iter()
        .take(limit)
        .map(|record| {
            let mut fields = record.split(FIELD_SEP);
            let hash = fields.next().unwrap_or("").to_string();
            let parents = fields.next().unwrap_or("").split(' ').filter(|s| !s.is_empty()).map(String::from).collect();
            let author = fields.next().unwrap_or("").to_string();
            let author_email = fields.next().unwrap_or("").to_string();
            let date = fields.next().unwrap_or("").to_string();
            let refs = fields.next().unwrap_or("").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            let subject = fields.next().unwrap_or("").to_string();
            GitCommitSummary { hash, parents, author, author_email, date, subject, refs }
        })
        .collect();

    Ok(GitLogResponse { commits, has_more })
}

pub async fn read_commit(project_path: &str, hash: &str) -> std::io::Result<GitCommitDetail> {
    assert_project_repository(project_path).await?;
    let format = format!("%H{FIELD_SEP}%P{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%aI{FIELD_SEP}%s{FIELD_SEP}%b");
    let format_arg = format!("--format={format}");
    let meta_out = git(project_path, &["show", "-s", &format_arg, hash]).await?;

    let mut fields = meta_out.splitn(7, FIELD_SEP);
    let meta_hash = fields.next().unwrap_or("").to_string();
    let parent_hashes: Vec<String> = fields.next().unwrap_or("").split(' ').filter(|s| !s.is_empty()).map(String::from).collect();
    let author = fields.next().unwrap_or("").to_string();
    let author_email = fields.next().unwrap_or("").to_string();
    let date = fields.next().unwrap_or("").to_string();
    let subject = fields.next().unwrap_or("").to_string();
    let body = fields.next().unwrap_or("").trim().to_string();

    let is_merge = !parent_hashes.is_empty();
    let range = if is_merge { format!("{}..{}", parent_hashes[0], meta_hash) } else { hash.to_string() };

    let (status_out, numstat_out, diff_out) = if is_merge {
        (
            git(project_path, &["diff", "--name-status", "-z", &range]).await.unwrap_or_default(),
            git(project_path, &["diff", "--numstat", "-z", &range]).await.unwrap_or_default(),
            git(project_path, &["diff", &range]).await.unwrap_or_default(),
        )
    } else {
        (
            git(project_path, &["show", "--format=", "--name-status", "-z", &range]).await.unwrap_or_default(),
            git(project_path, &["show", "--format=", "--numstat", "-z", &range]).await.unwrap_or_default(),
            git(project_path, &["show", "--format=", &range]).await.unwrap_or_default(),
        )
    };

    let status_by_path = parse_name_status_map(&status_out);
    let files: Vec<GitCommitFile> = parse_numstat_entries(&numstat_out)
        .into_iter()
        .map(|(additions, deletions, path)| {
            let status = status_by_path.get(&path).cloned().unwrap_or_else(|| "M".to_string());
            GitCommitFile { path, status, additions, deletions }
        })
        .collect();

    Ok(GitCommitDetail { hash: meta_hash, parents: parent_hashes, author, author_email, date, subject, body, files, diff: diff_out })
}

pub async fn checkout_ref(project_path: &str, r#ref: &str) -> std::io::Result<GitStatusResponse> {
    assert_project_repository(project_path).await?;
    git(project_path, &["checkout", r#ref]).await?;
    read_git_status(project_path).await
}

pub async fn fetch_all(project_path: &str) -> std::io::Result<GitBranchesResponse> {
    assert_project_repository(project_path).await?;
    git(project_path, &["fetch", "--all", "--prune"]).await?;
    list_branches(project_path).await
}

pub async fn pull_current_branch(project_path: &str) -> std::io::Result<GitStatusResponse> {
    assert_project_repository(project_path).await?;
    git(project_path, &["pull", "--no-rebase", "--no-edit"]).await?;
    read_git_status(project_path).await
}

fn parse_stash_subject(subject: &str) -> (String, String) {
    if let Some(colon) = subject.find(": ") {
        let head = &subject[..colon];
        let rest = subject[colon + 2..].to_string();
        let branch = head.strip_prefix("On ").or_else(|| head.strip_prefix("WIP on ")).unwrap_or(head);
        return (branch.to_string(), rest);
    }
    (String::new(), subject.to_string())
}

pub async fn list_stashes(project_path: &str) -> std::io::Result<Vec<GitStashSummary>> {
    assert_project_repository(project_path).await?;
    let format = format!("%H{FIELD_SEP}%gd{FIELD_SEP}%gs{FIELD_SEP}%aI");
    let format_arg = format!("--format={format}");
    let output = git(project_path, &["stash", "list", &format_arg]).await.unwrap_or_default();
    Ok(output
        .lines()
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(index, line)| {
            let mut fields = line.split(FIELD_SEP);
            let hash = fields.next().unwrap_or("").to_string();
            let r#ref = fields.next().unwrap_or("").to_string();
            let subject = fields.next().unwrap_or("").to_string();
            let date = fields.next().unwrap_or("").to_string();
            let (branch, message) = parse_stash_subject(&subject);
            GitStashSummary { index, r#ref, hash, branch, message, date }
        })
        .collect())
}

pub async fn apply_stash(project_path: &str, r#ref: &str) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    git(project_path, &["stash", "apply", r#ref]).await.map(|_| ())
}

pub async fn pop_stash(project_path: &str, r#ref: &str) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    git(project_path, &["stash", "pop", r#ref]).await.map(|_| ())
}

pub async fn drop_stash(project_path: &str, r#ref: &str) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    git(project_path, &["stash", "drop", r#ref]).await.map(|_| ())
}

pub async fn create_stash(project_path: &str, message: Option<&str>, include_untracked: bool) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("-u");
    }
    if let Some(message) = message {
        args.push("-m");
        args.push(message);
    }
    git(project_path, &args).await.map(|_| ())
}

pub async fn read_working_diff(project_path: &str, file: &str, staged: bool) -> std::io::Result<String> {
    assert_project_repository(project_path).await?;
    if !staged {
        let status = git(project_path, &["status", "--porcelain=v1", "--", file]).await.unwrap_or_default();
        if status.starts_with("??") {
            let content = tokio::fs::read_to_string(Path::new(project_path).join(file)).await.unwrap_or_default();
            let trimmed = content.strip_suffix("\r\n").or_else(|| content.strip_suffix('\n')).unwrap_or(&content);
            let lines: Vec<&str> = if trimmed.is_empty() { Vec::new() } else { trimmed.split(['\n']).map(|l| l.strip_suffix('\r').unwrap_or(l)).collect() };
            let body = lines.iter().map(|l| format!("+{l}")).collect::<Vec<_>>().join("\n");
            return Ok(format!(
                "diff --git a/{file} b/{file}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{} @@\n{body}\n",
                lines.len()
            ));
        }
    }
    let args: Vec<&str> = if staged { vec!["diff", "--cached", "--", file] } else { vec!["diff", "--", file] };
    Ok(git(project_path, &args).await.unwrap_or_default())
}

pub async fn stage_files(project_path: &str, files: &[String]) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    let mut args = vec!["add", "--"];
    args.extend(files.iter().map(|s| s.as_str()));
    git(project_path, &args).await.map(|_| ())
}

pub async fn unstage_files(project_path: &str, files: &[String]) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(files.iter().map(|s| s.as_str()));
    git(project_path, &args).await.map(|_| ())
}

/// `git restore` refuses to touch a pathspec it doesn't recognize as tracked,
/// and aborts the *entire* invocation if even one of several paths is
/// untracked — so untracked and tracked paths must be split and run through
/// separate commands (`clean` and `restore`) rather than one combined call.
pub async fn discard_files(project_path: &str, files: &[String]) -> std::io::Result<()> {
    assert_project_repository(project_path).await?;
    let mut status_args = vec!["status", "--porcelain=v1", "-z", "--"];
    status_args.extend(files.iter().map(|s| s.as_str()));
    let status_out = git(project_path, &status_args).await.unwrap_or_default();

    let mut untracked = Vec::new();
    let mut tracked = Vec::new();
    for entry in parse_status_entries(&status_out) {
        if entry.status.starts_with('?') {
            untracked.push(entry.path);
        } else {
            tracked.push(entry.path);
        }
    }

    if !tracked.is_empty() {
        let mut restore_args = vec!["restore", "--staged", "--worktree", "--"];
        restore_args.extend(tracked.iter().map(|s| s.as_str()));
        git(project_path, &restore_args).await?;
    }
    if !untracked.is_empty() {
        let mut clean_args = vec!["clean", "-fd", "--"];
        clean_args.extend(untracked.iter().map(|s| s.as_str()));
        git(project_path, &clean_args).await?;
    }
    Ok(())
}

pub async fn commit_changes(project_path: &str, message: &str) -> std::io::Result<GitStatusResponse> {
    assert_project_repository(project_path).await?;
    git(project_path, &["commit", "-m", message]).await?;
    read_git_status(project_path).await
}

/// Polls each watched project's git status and calls `on_change` when it
/// differs from the last read. The TS worker used recursive `fs.watch`
/// (notoriously unportable, especially recursive on non-Windows); polling
/// trades a couple seconds of latency for something that behaves the same on
/// every platform.
pub struct GitProjectWatcher {
    inner: std::sync::Arc<WatcherInner>,
}

struct WatcherInner {
    workspaces_dir: String,
    active: std::sync::atomic::AtomicBool,
    tasks: tokio::sync::Mutex<std::collections::HashMap<String, tokio::task::JoinHandle<()>>>,
    on_change: Box<dyn Fn(GitStatusResponse) + Send + Sync>,
}

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

pub fn watch_git_projects(workspaces_dir: &str, on_change: impl Fn(GitStatusResponse) + Send + Sync + 'static) -> GitProjectWatcher {
    let inner = std::sync::Arc::new(WatcherInner {
        workspaces_dir: workspaces_dir.to_string(),
        active: std::sync::atomic::AtomicBool::new(false),
        tasks: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        on_change: Box::new(on_change),
    });
    GitProjectWatcher { inner }
}

impl GitProjectWatcher {
    pub fn set_active(&self, active: bool) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let was_active = inner.active.swap(active, std::sync::atomic::Ordering::SeqCst);
            if was_active == active {
                return;
            }
            if active {
                discover(&inner).await;
            } else {
                let mut tasks = inner.tasks.lock().await;
                for (_, handle) in tasks.drain() {
                    handle.abort();
                }
            }
        });
    }

    pub fn watch(&self, project_path: &str) {
        if !self.inner.active.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let inner = self.inner.clone();
        let project_path = project_path.to_string();
        tokio::spawn(async move { add_project(&inner, &project_path).await });
    }

    pub fn stop(&self) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            inner.active.store(false, std::sync::atomic::Ordering::SeqCst);
            let mut tasks = inner.tasks.lock().await;
            for (_, handle) in tasks.drain() {
                handle.abort();
            }
        });
    }
}

async fn discover(inner: &std::sync::Arc<WatcherInner>) {
    if !inner.active.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Ok(mut workspaces) = tokio::fs::read_dir(&inner.workspaces_dir).await else { return };
    while let Ok(Some(workspace)) = workspaces.next_entry().await {
        let Ok(file_type) = workspace.file_type().await else { continue };
        let name = workspace.file_name().to_string_lossy().to_string();
        if !file_type.is_dir() || name.starts_with('.') {
            continue;
        }
        let Ok(mut projects) = tokio::fs::read_dir(workspace.path()).await else { continue };
        while let Ok(Some(project)) = projects.next_entry().await {
            let Ok(project_type) = project.file_type().await else { continue };
            let project_name = project.file_name().to_string_lossy().to_string();
            if project_type.is_dir() && !project_name.starts_with('.') {
                add_project(inner, &project.path().to_string_lossy()).await;
            }
        }
    }
}

async fn add_project(inner: &std::sync::Arc<WatcherInner>, project_path: &str) {
    {
        let tasks = inner.tasks.lock().await;
        if tasks.contains_key(project_path) {
            return;
        }
    }
    let inner_clone = inner.clone();
    let key = project_path.to_string();
    let watched_path = project_path.to_string();
    let handle = tokio::spawn(async move {
        let mut previous: Option<String> = None;
        loop {
            if !inner_clone.active.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
            match read_git_status(&watched_path).await {
                Ok(status) => {
                    let serialized = serde_json::to_string(&status).unwrap_or_default();
                    if let Some(prev) = &previous {
                        if *prev != serialized {
                            (inner_clone.on_change)(status);
                        }
                    }
                    previous = Some(serialized);
                }
                Err(_) => previous = None,
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
    inner.tasks.lock().await.insert(key, handle);
}
