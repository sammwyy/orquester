//! Fan-out for daemon events to every connected `/events` client. Mirrors
//! apps/daemon/src/broadcaster.ts.

use serde::Serialize;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

pub struct Broadcaster {
    sender: broadcast::Sender<String>,
    client_count: std::sync::atomic::AtomicUsize,
    count_listeners: std::sync::Mutex<Vec<Box<dyn Fn(usize) + Send + Sync>>>,
}

impl Broadcaster {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            sender,
            client_count: std::sync::atomic::AtomicUsize::new(0),
            count_listeners: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.sender.subscribe()
    }

    /// Call when a `/events` client connects or disconnects; drives
    /// integration watchers active/inactive the same way the TS version does.
    pub fn set_client_delta(&self, delta: i64) {
        let previous = self.client_count.load(std::sync::atomic::Ordering::SeqCst);
        let next = (previous as i64 + delta).max(0) as usize;
        self.client_count.store(next, std::sync::atomic::Ordering::SeqCst);
        for listener in self.count_listeners.lock().unwrap().iter() {
            listener(next);
        }
    }

    pub fn on_client_count_change(&self, listener: impl Fn(usize) + Send + Sync + 'static) {
        listener(self.client_count.load(std::sync::atomic::Ordering::SeqCst));
        self.count_listeners.lock().unwrap().push(Box::new(listener));
    }

    pub fn client_count(&self) -> usize {
        self.client_count.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn publish<T: Serialize>(&self, channel: &str, kind: &str, payload: &T) {
        let event = crate::api_types::EventMessage {
            id: uuid::Uuid::new_v4().to_string(),
            channel: channel.to_string(),
            kind: kind.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            payload,
        };
        if let Ok(data) = serde_json::to_string(&event) {
            // No subscribers is a normal (not error) state.
            let _ = self.sender.send(data);
        }
    }
}
