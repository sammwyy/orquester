//! PTY session management using portable-pty.
//! instead of node-pty. Sessions outlive client connections: output is
//! buffered so a (re)connecting client gets the current screen, and lifecycle
//! changes go straight onto the broadcaster for cross-client sync.

use crate::api_types::{CreateSessionRequest, SessionStatus, SessionSummary};
use crate::broadcaster::Broadcaster;
use crate::registry::RegistryService;
use bytes::Bytes;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, RwLock};

/// Cap the replay buffer so long-lived sessions don't grow unbounded.
const MAX_BUFFER: usize = 256 * 1024;

pub struct SessionError(pub String);

struct Session {
    summary: Mutex<SessionSummary>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    child_killer: Mutex<Option<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
    buffer: Mutex<Vec<u8>>,
    output_tx: broadcast::Sender<Bytes>,
    exit_code: AtomicI32,
    exited: std::sync::atomic::AtomicBool,
    /// Last time a PTY output chunk arrived; the activity ticker compares
    /// against this to decide when a session goes from active back to idle.
    last_activity: Mutex<std::time::Instant>,
}

/// How long a session stays "active" after its last byte of output.
const ACTIVITY_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(2_000);
/// How often the idle sweep checks every live session against that timeout.
const ACTIVITY_TICK: std::time::Duration = std::time::Duration::from_millis(500);

pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, Arc<Session>>>>,
    registry: Arc<RegistryService>,
    broadcaster: Arc<Broadcaster>,
}

impl SessionManager {
    pub fn new(registry: Arc<RegistryService>, broadcaster: Arc<Broadcaster>) -> Self {
        let manager = Self { sessions: Arc::new(RwLock::new(HashMap::new())), registry, broadcaster };
        manager.spawn_activity_ticker();
        manager
    }

    /// Sweeps every live session for `active` sessions that have gone quiet
    /// past `ACTIVITY_TIMEOUT` and flips them back to idle. The other
    /// direction (idle -> active) reacts instantly from the output-pump
    /// thread instead, so only "stopped producing output" needs polling.
    /// Cheap enough (in-memory timestamp checks) to just always run rather
    /// than gating it behind connected-client/integration checks like the
    /// other watchers.
    fn spawn_activity_ticker(&self) {
        let sessions = self.sessions.clone();
        let broadcaster = self.broadcaster.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(ACTIVITY_TICK).await;
                let live: Vec<Arc<Session>> = sessions.read().await.values().cloned().collect();
                for session in live {
                    let idle_for = session.last_activity.lock().unwrap().elapsed();
                    if idle_for < ACTIVITY_TIMEOUT {
                        continue;
                    }
                    let updated = {
                        let mut summary = session.summary.lock().unwrap();
                        if !summary.active {
                            None
                        } else {
                            summary.active = false;
                            Some(summary.clone())
                        }
                    };
                    if let Some(updated) = updated {
                        broadcaster.publish("sessions", "session.updated", &updated);
                    }
                }
            }
        });
    }

    pub async fn create(&self, req: CreateSessionRequest) -> Result<SessionSummary, SessionError> {
        let ref_id = req.ref_id.ok_or_else(|| SessionError("refId is required.".to_string()))?;
        let (bin, kind, name) = self
            .registry
            .resolved_bin(&ref_id)
            .await
            .ok_or_else(|| SessionError(format!("Registry entry \"{ref_id}\" is not available.")))?;

        let cols = req.cols.filter(|c| *c > 0).unwrap_or(80);
        let rows = req.rows.filter(|r| *r > 0).unwrap_or(24);
        let cwd = req
            .cwd
            .filter(|c| !c.is_empty())
            .or_else(|| req.project_path.clone().filter(|c| !c.is_empty()))
            .unwrap_or_else(|| std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default());

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| SessionError(format!("Cannot allocate a pty: {e}")))?;

        let mut cmd = CommandBuilder::new(&bin);
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| SessionError(format!("Cannot start \"{ref_id}\": {e}")))?;
        drop(pair.slave);

        let id = uuid::Uuid::new_v4().to_string();
        let pid = child.process_id();
        let summary = SessionSummary {
            id: id.clone(),
            kind,
            ref_id: ref_id.clone(),
            title: req.title.filter(|t| !t.is_empty()).unwrap_or(name),
            project_path: req.project_path.unwrap_or_default(),
            cwd,
            cols,
            rows,
            status: SessionStatus::Running,
            exit_code: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            pid,
            active: false,
            needs_attention: false,
        };

        let reader = pair.master.try_clone_reader().map_err(|e| SessionError(format!("Cannot read pty output: {e}")))?;
        let writer = pair.master.take_writer().map_err(|e| SessionError(format!("Cannot write pty input: {e}")))?;
        let killer = child.clone_killer();

        let (output_tx, _) = broadcast::channel(1024);
        let session = Arc::new(Session {
            summary: Mutex::new(summary.clone()),
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(Some(pair.master)),
            child_killer: Mutex::new(Some(killer)),
            buffer: Mutex::new(Vec::new()),
            output_tx,
            exit_code: AtomicI32::new(0),
            exited: std::sync::atomic::AtomicBool::new(false),
            last_activity: Mutex::new(std::time::Instant::now()),
        });

        self.sessions.write().await.insert(id.clone(), session.clone());

        // portable-pty's reader is blocking; pump it on a dedicated OS thread
        // and fan output out to the buffer + broadcast channel.
        {
            let session = session.clone();
            let broadcaster = self.broadcaster.clone();
            std::thread::spawn(move || {
                let mut reader = reader;
                let mut chunk = [0u8; 8192];
                loop {
                    match std::io::Read::read(&mut reader, &mut chunk) {
                        Ok(0) => break,
                        Ok(n) => {
                            let data = Bytes::copy_from_slice(&chunk[..n]);
                            *session.last_activity.lock().unwrap() = std::time::Instant::now();

                            // Bell (0x07) is the classic "I'm done" signal most
                            // CLIs — including OSC 9/777 notifications, which
                            // are conventionally BEL-terminated too — already
                            // emit, so a raw byte scan catches both without a
                            // full OSC-aware parser.
                            let has_bell = chunk[..n].contains(&0x07);
                            let changed_summary = {
                                let mut summary = session.summary.lock().unwrap();
                                let mut changed = false;
                                if !summary.active {
                                    summary.active = true;
                                    changed = true;
                                }
                                if has_bell && !summary.needs_attention {
                                    summary.needs_attention = true;
                                    changed = true;
                                }
                                changed.then(|| summary.clone())
                            };
                            if let Some(updated) = changed_summary {
                                broadcaster.publish("sessions", "session.updated", &updated);
                            }

                            {
                                let mut buffer = session.buffer.lock().unwrap();
                                buffer.extend_from_slice(&data);
                                if buffer.len() > MAX_BUFFER {
                                    let excess = buffer.len() - MAX_BUFFER;
                                    buffer.drain(0..excess);
                                }
                            }
                            let _ = session.output_tx.send(data);
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // Wait for exit on a dedicated thread (portable-pty's Child::wait blocks).
        // The tokio Handle lets that OS thread hop back into async code to
        // check whether the session is still tracked and to publish the event.
        {
            let session = session.clone();
            let sessions = self.sessions.clone();
            let broadcaster = self.broadcaster.clone();
            let id = id.clone();
            let runtime = tokio::runtime::Handle::current();
            std::thread::spawn(move || {
                let status = child.wait();
                let exit_code = status.map(|s| s.exit_code() as i32).unwrap_or(1);
                session.exit_code.store(exit_code, Ordering::SeqCst);
                session.exited.store(true, Ordering::SeqCst);
                // An explicit close() already removed this session and told
                // clients so; the child dying from that kill is expected, not
                // a fresh lifecycle event.
                let still_tracked = runtime.block_on(async { sessions.read().await.contains_key(&id) });
                if !still_tracked {
                    return;
                }
                let updated = {
                    let mut summary = session.summary.lock().unwrap();
                    summary.status = SessionStatus::Exited;
                    summary.exit_code = Some(exit_code);
                    summary.active = false;
                    summary.needs_attention = true;
                    summary.clone()
                };
                broadcaster.publish("sessions", "session.exited", &updated);
                let _ = session.output_tx.send(Bytes::new());
            });
        }

        self.broadcaster.publish("sessions", "session.created", &summary);
        Ok(summary)
    }

    pub async fn list(&self, project_path: Option<&str>) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().await;
        sessions
            .values()
            .map(|s| s.summary.lock().unwrap().clone())
            .filter(|s| project_path.map(|p| p == s.project_path).unwrap_or(true))
            .collect()
    }

    /// Non-blocking snapshot for sync callers (e.g. the networking watcher's
    /// `get_sessions` hook). Returns `None` only under rare lock contention.
    pub fn try_list(&self) -> Option<Vec<SessionSummary>> {
        let sessions = self.sessions.try_read().ok()?;
        Some(sessions.values().map(|s| s.summary.lock().unwrap().clone()).collect())
    }

    pub async fn get(&self, id: &str) -> Option<SessionSummary> {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| s.summary.lock().unwrap().clone())
    }

    /// Clears `needs_attention` — called when a client actually focuses this
    /// session's tab, not just when it appears in a list.
    pub async fn acknowledge(&self, id: &str) -> Option<SessionSummary> {
        let sessions = self.sessions.read().await;
        let session = sessions.get(id)?;
        let (already_clear, updated) = {
            let mut summary = session.summary.lock().unwrap();
            let already_clear = !summary.needs_attention;
            summary.needs_attention = false;
            (already_clear, summary.clone())
        };
        if !already_clear {
            self.broadcaster.publish("sessions", "session.updated", &updated);
        }
        Some(updated)
    }

    pub async fn buffer(&self, id: &str) -> Vec<u8> {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| s.buffer.lock().unwrap().clone()).unwrap_or_default()
    }

    pub async fn input(&self, id: &str, data: &str) {
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(id) {
            if let Some(writer) = session.writer.lock().unwrap().as_mut() {
                let _ = writer.write_all(data.as_bytes());
                let _ = writer.flush();
            }
        }
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) {
        if cols == 0 || rows == 0 {
            return;
        }
        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(id) {
            if let Some(master) = session.master.lock().unwrap().as_ref() {
                let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            }
            let mut summary = session.summary.lock().unwrap();
            summary.cols = cols;
            summary.rows = rows;
        }
    }

    /// Kill (if running) and forget a session. Returns false if unknown.
    pub async fn close(&self, id: &str) -> bool {
        let removed = self.sessions.write().await.remove(id);
        let Some(session) = removed else { return false };
        if let Some(killer) = session.child_killer.lock().unwrap().as_mut() {
            let _ = killer.kill();
        }
        self.broadcaster.publish("sessions", "session.closed", &serde_json::json!({ "id": id }));
        true
    }

    pub async fn close_all(&self) {
        let ids: Vec<String> = self.sessions.read().await.keys().cloned().collect();
        for id in ids {
            self.close(&id).await;
        }
    }

    /// Live output stream for one session: bytes as they arrive, terminated
    /// when the pty exits or the receiver is dropped.
    pub async fn subscribe(&self, id: &str) -> Option<broadcast::Receiver<Bytes>> {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| s.output_tx.subscribe())
    }

    pub async fn is_exited(&self, id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.get(id).map(|s| s.exited.load(Ordering::SeqCst)).unwrap_or(true)
    }
}
