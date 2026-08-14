use crate::api_types::{ProjectSummary, RecentProjectSummary};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

const MAX_RECENT_PROJECTS: usize = 30;

pub struct RecentProjectsService {
    path: PathBuf,
    entries: RwLock<Vec<RecentProjectSummary>>,
}

impl RecentProjectsService {
    pub async fn load(path: PathBuf) -> Arc<Self> {
        let entries = match tokio::fs::read_to_string(&path).await {
            Ok(raw) => serde_json::from_str::<Vec<RecentProjectSummary>>(&raw).unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        Arc::new(Self { path, entries: RwLock::new(normalize(entries)) })
    }

    pub async fn list(&self) -> Vec<RecentProjectSummary> {
        self.entries.read().await.clone()
    }

    pub async fn mark_interacted(&self, project: ProjectSummary) -> RecentProjectSummary {
        let now = chrono::Utc::now().to_rfc3339();
        let mut entries = self.entries.write().await;
        if let Some(existing) = entries.iter_mut().find(|item| item.path == project.path) {
            existing.name = project.name;
            existing.workspace = project.workspace;
            existing.last_interacted_at = now;
            existing.interaction_count = existing.interaction_count.saturating_add(1);
        } else {
            entries.push(RecentProjectSummary {
                name: project.name,
                workspace: project.workspace,
                path: project.path,
                last_interacted_at: now,
                interaction_count: 1,
            });
        }
        entries.sort_by(|a, b| b.last_interacted_at.cmp(&a.last_interacted_at));
        entries.truncate(MAX_RECENT_PROJECTS);
        let result = entries[0].clone();
        let snapshot = entries.clone();
        drop(entries);
        let _ = persist(&self.path, &snapshot).await;
        result
    }
}

fn normalize(mut entries: Vec<RecentProjectSummary>) -> Vec<RecentProjectSummary> {
    entries.retain(|entry| !entry.path.is_empty() && !entry.name.is_empty() && !entry.workspace.is_empty());
    entries.sort_by(|a, b| b.last_interacted_at.cmp(&a.last_interacted_at));
    entries.truncate(MAX_RECENT_PROJECTS);
    entries
}

async fn persist(path: &PathBuf, entries: &[RecentProjectSummary]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(entries).expect("recent projects always serialize");
    tokio::fs::write(path, format!("{json}\n")).await
}
