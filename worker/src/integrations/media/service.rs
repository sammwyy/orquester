//! Cross-platform media integration.
//! Windows uses native GSMTC bindings; Linux uses the MPRIS interface through
//! playerctl, which is the common bridge exposed by desktop media players.

use crate::api_types::{MediaAction, MediaControlRequest, MediaPlaybackState, MediaStatusResponse};

pub async fn is_media_available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(not(windows))]
    {
        tokio::process::Command::new("playerctl")
            .arg("--version")
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod linux {
    use super::*;
    use sha1::{Digest, Sha1};
    use std::process::Stdio;

    fn stopped() -> MediaStatusResponse {
        MediaStatusResponse {
            available: true,
            player: None,
            title: None,
            artist: None,
            album: None,
            state: MediaPlaybackState::Stopped,
            volume: 0.0,
            volume_available: false,
            thumbnail_key: None,
        }
    }

    async fn playerctl(args: &[&str]) -> Option<String> {
        let output = tokio::process::Command::new("playerctl")
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await
            .ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn optional(value: &str) -> Option<String> {
        let value = value.trim();
        (!value.is_empty() && value != "(null)").then(|| value.to_string())
    }

    /// The active player's line from `playerctl -a metadata`: whichever
    /// player isn't `Stopped`, falling back to the first one so a single
    /// idle player still reports something instead of nothing.
    async fn active_metadata_line(format: &str) -> Option<String> {
        let metadata = playerctl(&["-a", "metadata", "--format", format]).await?;
        let status_index = format.matches("{{").count() - 1;
        metadata
            .lines()
            .find(|line| {
                line.split('\t').nth(status_index).map(|status| status.trim() != "Stopped").unwrap_or(false)
            })
            .or_else(|| metadata.lines().next())
            .map(str::to_string)
    }

    fn art_url_key(art_url: &str) -> String {
        let mut hasher = Sha1::new();
        hasher.update(art_url.as_bytes());
        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    pub async fn read_status() -> MediaStatusResponse {
        let Some(line) = active_metadata_line("{{playerName}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}\t{{status}}").await else {
            return stopped();
        };
        let fields: Vec<&str> = line.split('\t').collect();
        let state = match fields.get(5).map(|value| value.trim()) {
            Some("Playing") => MediaPlaybackState::Playing,
            Some("Paused") => MediaPlaybackState::Paused,
            _ => MediaPlaybackState::Stopped,
        };
        let volume = playerctl(&["volume"])
            .await
            .and_then(|value| value.trim().parse::<f64>().ok())
            .unwrap_or(0.0);
        let art_url = fields.get(4).and_then(|value| optional(value));
        MediaStatusResponse {
            available: true,
            player: fields.first().and_then(|value| optional(value)),
            title: fields.get(1).and_then(|value| optional(value)),
            artist: fields.get(2).and_then(|value| optional(value)),
            album: fields.get(3).and_then(|value| optional(value)),
            state,
            volume,
            volume_available: true,
            thumbnail_key: art_url.as_deref().map(art_url_key),
        }
    }

    /// `mpris:artUrl` is usually a `file://` path into the player's local
    /// cache; fetch and re-read it fresh rather than trusting the key, which
    /// only exists for the client's change-detection.
    pub async fn read_thumbnail() -> Option<(Vec<u8>, &'static str)> {
        let line = active_metadata_line("{{mpris:artUrl}}\t{{status}}").await?;
        let art_url = line.split('\t').next().and_then(optional)?;
        let url = url::Url::parse(&art_url).ok()?;
        let path = url.to_file_path().ok()?;
        let bytes = tokio::fs::read(&path).await.ok()?;
        let mime = match path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_lowercase()) {
            Some(ext) if ext == "png" => "image/png",
            Some(ext) if ext == "gif" => "image/gif",
            Some(ext) if ext == "webp" => "image/webp",
            Some(ext) if ext == "bmp" => "image/bmp",
            _ => "image/jpeg",
        };
        Some((bytes, mime))
    }

    pub async fn control(request: &MediaControlRequest) -> MediaStatusResponse {
        match request.action {
            Some(MediaAction::PlayPause) => {
                let _ = playerctl(&["play-pause"]).await;
            }
            Some(MediaAction::Next) => {
                let _ = playerctl(&["next"]).await;
            }
            Some(MediaAction::Previous) => {
                let _ = playerctl(&["previous"]).await;
            }
            Some(MediaAction::Volume) => {
                if let Some(volume) = request.volume {
                    let value = volume.to_string();
                    let _ = playerctl(&["volume", &value]).await;
                }
            }
            None => {}
        }
        read_status().await
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use sha1::{Digest, Sha1};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    /// GSMTC calls are blocking WinRT `.get()` waits; run them on a blocking
    /// thread so they never stall the tokio runtime, and catch_unwind so a
    /// COM panic degrades to "unavailable" instead of taking the worker down.
    async fn run_blocking<T: Send + 'static>(
        f: impl FnOnce() -> windows::core::Result<T> + Send + 'static,
    ) -> Option<T> {
        tokio::task::spawn_blocking(move || {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))
                .ok()
                .and_then(|r| r.ok())
        })
        .await
        .ok()
        .flatten()
    }

    fn current_session() -> windows::core::Result<Session> {
        let manager = Manager::RequestAsync()?.get()?;
        manager.GetCurrentSession()
    }

    fn status_to_state(status: PlaybackStatus) -> MediaPlaybackState {
        match status {
            PlaybackStatus::Playing => MediaPlaybackState::Playing,
            PlaybackStatus::Paused => MediaPlaybackState::Paused,
            _ => MediaPlaybackState::Stopped,
        }
    }

    fn with_audio_endpoint<T>(
        f: impl FnOnce(IAudioEndpointVolume) -> windows::core::Result<T>,
    ) -> windows::core::Result<T> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }?;
        let result = (|| {
            let enumerator: IMMDeviceEnumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }?;
            let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }?;
            let endpoint = unsafe { device.Activate(CLSCTX_ALL, None) }?;
            f(endpoint)
        })();
        unsafe { CoUninitialize() };
        result
    }

    fn master_volume() -> windows::core::Result<f64> {
        with_audio_endpoint(|endpoint| Ok(unsafe { endpoint.GetMasterVolumeLevelScalar()? } as f64))
    }

    fn set_master_volume(volume: f64) -> windows::core::Result<()> {
        with_audio_endpoint(|endpoint| unsafe {
            endpoint.SetMasterVolumeLevelScalar(volume.clamp(0.0, 1.0) as f32, std::ptr::null())
        })
    }

    fn thumbnail_key(player: &str, title: &str, artist: &str, album: &str) -> String {
        let mut hasher = Sha1::new();
        hasher.update(player.as_bytes());
        hasher.update([0]);
        hasher.update(title.as_bytes());
        hasher.update([0]);
        hasher.update(artist.as_bytes());
        hasher.update([0]);
        hasher.update(album.as_bytes());
        hex_encode(&hasher.finalize())
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn read_session_status(session: &Session) -> windows::core::Result<MediaStatusResponse> {
        let playback_info = session.GetPlaybackInfo()?;
        let status = playback_info.PlaybackStatus()?;
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let player = session
            .SourceAppUserModelId()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();
        let title = props
            .Title()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();
        let artist = props
            .Artist()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();
        let album = props
            .AlbumTitle()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();

        if title.trim().is_empty() && artist.trim().is_empty() {
            return Ok(MediaStatusResponse {
                available: true,
                player: None,
                title: None,
                artist: None,
                album: None,
                state: MediaPlaybackState::Stopped,
                volume: 0.0,
                volume_available: false,
                thumbnail_key: None,
            });
        }

        let key = thumbnail_key(&player, &title, &artist, &album);
        Ok(MediaStatusResponse {
            available: true,
            player: if player.is_empty() {
                None
            } else {
                Some(player)
            },
            title: if title.trim().is_empty() {
                None
            } else {
                Some(title.trim().to_string())
            },
            artist: if artist.trim().is_empty() {
                None
            } else {
                Some(artist.trim().to_string())
            },
            album: if album.trim().is_empty() {
                None
            } else {
                Some(album.trim().to_string())
            },
            state: status_to_state(status),
            volume: 0.0,
            volume_available: false,
            thumbnail_key: Some(key),
        })
    }

    fn stopped() -> MediaStatusResponse {
        MediaStatusResponse {
            available: true,
            player: None,
            title: None,
            artist: None,
            album: None,
            state: MediaPlaybackState::Stopped,
            volume: 0.0,
            volume_available: false,
            thumbnail_key: None,
        }
    }

    pub async fn read_status() -> MediaStatusResponse {
        run_blocking(|| {
            let volume = master_volume();
            let mut status = current_session()
                .and_then(|session| read_session_status(&session))
                .unwrap_or_else(|_| stopped());
            let volume_available = volume.is_ok();
            status.volume = volume.unwrap_or(0.0);
            status.volume_available = volume_available;
            Ok(status)
        })
        .await
        .unwrap_or_else(stopped)
    }

    pub async fn read_thumbnail() -> Option<(Vec<u8>, &'static str)> {
        run_blocking(|| {
            let session = current_session()?;
            let props = session.TryGetMediaPropertiesAsync()?.get()?;
            let thumbnail = props.Thumbnail()?;
            let stream = thumbnail.OpenReadAsync()?.get()?;
            let size = stream.Size()? as u32;
            if size == 0 {
                return Err(windows::core::Error::from(
                    windows::Win32::Foundation::E_FAIL,
                ));
            }
            let reader = windows::Storage::Streams::DataReader::CreateDataReader(&stream)?;
            reader.LoadAsync(size)?.get()?;
            let mut buffer = vec![0u8; size as usize];
            reader.ReadBytes(&mut buffer)?;
            Ok(buffer)
        })
        .await
        .map(|bytes| (bytes, "image/jpeg"))
    }

    pub async fn control(request: &MediaControlRequest) -> MediaStatusResponse {
        if let Some(action) = request.action {
            let volume = request.volume.unwrap_or_default();
            let applied = run_blocking(move || match action {
                MediaAction::Volume => set_master_volume(volume),
                MediaAction::PlayPause | MediaAction::Next | MediaAction::Previous => {
                    let session = current_session()?;
                    match action {
                        MediaAction::PlayPause => {
                            session.TryTogglePlayPauseAsync()?.get().map(|_| ())
                        }
                        MediaAction::Next => session.TrySkipNextAsync()?.get().map(|_| ()),
                        MediaAction::Previous => session.TrySkipPreviousAsync()?.get().map(|_| ()),
                        MediaAction::Volume => unreachable!(),
                    }
                }
            })
            .await;
            let mut status = read_status().await;
            if action == MediaAction::Volume && applied.is_some() {
                status.volume = volume.clamp(0.0, 1.0);
                status.volume_available = true;
            }
            return status;
        }
        read_status().await
    }
}

pub async fn read_media_status() -> MediaStatusResponse {
    #[cfg(windows)]
    {
        win::read_status().await
    }
    #[cfg(not(windows))]
    {
        linux::read_status().await
    }
}

pub async fn read_media_thumbnail() -> Option<(Vec<u8>, &'static str)> {
    #[cfg(windows)]
    {
        win::read_thumbnail().await
    }
    #[cfg(not(windows))]
    {
        linux::read_thumbnail().await
    }
}

pub async fn control_media(request: &MediaControlRequest) -> MediaStatusResponse {
    #[cfg(windows)]
    {
        win::control(request).await
    }
    #[cfg(not(windows))]
    {
        linux::control(request).await
    }
}

pub struct MediaWatcher {
    active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    on_change: std::sync::Arc<dyn Fn(MediaStatusResponse) + Send + Sync>,
}

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

pub fn watch_media(
    on_change: impl Fn(MediaStatusResponse) + Send + Sync + 'static,
) -> MediaWatcher {
    MediaWatcher {
        active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        task: std::sync::Mutex::new(None),
        on_change: std::sync::Arc::new(on_change),
    }
}

impl MediaWatcher {
    pub fn set_active(&self, active: bool) {
        let was_active = self
            .active
            .swap(active, std::sync::atomic::Ordering::SeqCst);
        if was_active == active {
            return;
        }
        let mut task = self.task.lock().unwrap();
        if active {
            let active_flag = self.active.clone();
            let on_change = self.on_change.clone();
            *task = Some(tokio::spawn(async move {
                let mut previous: Option<String> = None;
                while active_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    let status = read_media_status().await;
                    let serialized = serde_json::to_string(&status).unwrap_or_default();
                    if previous.as_ref() != Some(&serialized) {
                        previous = Some(serialized);
                        on_change(status);
                    }
                    tokio::time::sleep(POLL_INTERVAL).await;
                }
            }));
        } else if let Some(handle) = task.take() {
            handle.abort();
        }
    }

    pub fn stop(&self) {
        self.set_active(false);
    }
}
