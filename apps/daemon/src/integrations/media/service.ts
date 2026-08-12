import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { MediaControlRequest, MediaStatusResponse } from "@orquester/api";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL = 2_000;

async function playerctl(args: string[]): Promise<string> {
  const result = await execFileAsync("playerctl", args, { maxBuffer: 512 * 1024, windowsHide: true });
  return result.stdout.trim();
}

async function powershell(script: string): Promise<string> {
  const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    maxBuffer: 512 * 1024,
    windowsHide: true
  });
  return result.stdout.trim();
}

const windowsMediaScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await($operation) {
  $task = [System.WindowsRuntimeSystemExtensions]::AsTask($operation)
  $task.GetAwaiter().GetResult()
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
$session = $manager.GetCurrentSession()
if ($null -eq $session) { exit 3 }
$info = $session.GetPlaybackInfo()
$props = Await ($session.TryGetMediaPropertiesAsync())
[pscustomobject]@{
  Player = $session.SourceAppUserModelId
  State = $info.PlaybackStatus.ToString()
  Title = $props.Title
  Artist = $props.Artist
  Album = $props.AlbumTitle
} | ConvertTo-Json -Compress
`;

const windowsThumbnailScript = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await($operation) {
  $task = [System.WindowsRuntimeSystemExtensions]::AsTask($operation)
  $task.GetAwaiter().GetResult()
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
$session = $manager.GetCurrentSession()
if ($null -eq $session) { exit 3 }
$props = Await ($session.TryGetMediaPropertiesAsync())
if ($null -eq $props.Thumbnail) { exit 4 }
$stream = Await ($props.Thumbnail.OpenReadAsync())
$reader = New-Object Windows.Storage.Streams.DataReader($stream)
$size = [uint32]$stream.Size
Await ($reader.LoadAsync($size)) | Out-Null
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[Convert]::ToBase64String($bytes)
`;

async function readWindowsMedia(): Promise<MediaStatusResponse> {
  try {
    const value = JSON.parse(await powershell(windowsMediaScript)) as { Player?: string; State?: string; Title?: string; Artist?: string; Album?: string };
    const state = value.State?.toLowerCase() === "playing" ? "playing" : value.State?.toLowerCase() === "paused" ? "paused" : "stopped";
    const title = value.Title?.trim() || undefined;
    const artist = value.Artist?.trim() || undefined;
    const album = value.Album?.trim() || undefined;
    if (!title && !artist) return { available: true, state: "stopped", volume: 0, volumeAvailable: false };
    const thumbnailKey = createHash("sha1").update(`${value.Player}\0${title}\0${artist}\0${album}`).digest("hex");
    return { available: true, player: value.Player, title, artist, album, state, volume: 0.5, volumeAvailable: false, thumbnailKey };
  } catch {
    return { available: true, state: "stopped", volume: 0, volumeAvailable: false };
  }
}

async function readMacMedia(): Promise<MediaStatusResponse> {
  try {
    const output = await execFileAsync("osascript", ["-e", `
      tell application "System Events"
        if not (name of processes contains "Music") then return ""
      end tell
      tell application "Music"
        set currentState to player state as text
        set currentTitle to name of current track
        set currentArtist to artist of current track
        set currentAlbum to album of current track
        set currentVolume to sound volume
        return currentState & tab & currentTitle & tab & currentArtist & tab & currentAlbum & tab & currentVolume
      end tell
    `], { maxBuffer: 512 * 1024, windowsHide: true });
    const [rawState, title, artist, album, rawVolume] = output.stdout.trim().split("\t");
    if (!title && !artist) return { available: true, state: "stopped", volume: 0, volumeAvailable: true };
    const state = rawState?.toLowerCase() === "playing" ? "playing" : rawState?.toLowerCase() === "paused" ? "paused" : "stopped";
    const thumbnailKey = createHash("sha1").update(`${title}\0${artist}\0${album}`).digest("hex");
    return { available: true, player: "Music", title, artist, album, state, volume: Math.max(0, Math.min(1, (Number(rawVolume) || 0) / 100)), volumeAvailable: true, thumbnailKey };
  } catch {
    return { available: true, state: "stopped", volume: 0, volumeAvailable: true };
  }
}

export async function isMediaAvailable(): Promise<boolean> {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  if (process.platform !== "linux") return false;
  try {
    await playerctl(["-l"]);
    return true;
  } catch {
    return false;
  }
}

export async function readMediaStatus(): Promise<MediaStatusResponse> {
  if (process.platform === "win32") return readWindowsMedia();
  if (process.platform === "darwin") return readMacMedia();
  if (!(await isMediaAvailable())) {
    return { available: false, state: "stopped", volume: 0, volumeAvailable: false };
  }
  try {
    const metadata = await playerctl([
      "-a",
      "metadata",
      "--format",
      "{{playerName}}\t{{status}}\t{{title}}\t{{artist}}\t{{album}}\t{{mpris:artUrl}}"
    ]);
    const [player, rawState, title, artist, album, artwork] = metadata.split(/\r?\n/)[0]?.split("\t") ?? [];
    const volumeOutput = await playerctl(["volume"]).catch(() => "0");
    const volume = Math.max(0, Math.min(1, Number.parseFloat(volumeOutput) || 0));
    const state = rawState?.toLowerCase() === "playing" ? "playing" : rawState?.toLowerCase() === "paused" ? "paused" : "stopped";
    const thumbnailKey = artwork ? createHash("sha1").update(`${artwork}\0${title}\0${artist}\0${album}`).digest("hex") : undefined;
    if (!title && !artist) return { available: true, state: "stopped", volume: 0, volumeAvailable: true };
    return { available: true, player, title, artist, album, state, volume, volumeAvailable: true, thumbnailKey };
  } catch {
    return { available: true, state: "stopped", volume: 0, volumeAvailable: true };
  }
}

export async function readMediaThumbnail(): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    if (process.platform === "win32") {
      const encoded = await powershell(windowsThumbnailScript);
      return encoded ? { data: Buffer.from(encoded, "base64"), mimeType: "image/jpeg" } : null;
    }
    if (process.platform !== "linux") return null;
    const artworkOutput = await playerctl(["-a", "metadata", "mpris:artUrl"]);
    const artwork = artworkOutput.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
    if (!artwork) return null;
    if (artwork.startsWith("file://")) {
      const data = await readFile(new URL(artwork));
      return { data, mimeType: artwork.endsWith(".png") ? "image/png" : "image/jpeg" };
    }
    if (artwork.startsWith("http://") || artwork.startsWith("https://")) {
      const response = await fetch(artwork);
      if (!response.ok) return null;
      return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") ?? "image/jpeg" };
    }
  } catch {
    return null;
  }
  return null;
}

export async function controlMedia(request: MediaControlRequest): Promise<MediaStatusResponse> {
  if (process.platform === "win32") {
    const action = request.action === "playPause" ? "TryTogglePlayPauseAsync" : request.action === "next" ? "TrySkipNextAsync" : request.action === "previous" ? "TrySkipPreviousAsync" : "";
    if (action) {
      await powershell(`${windowsMediaScript}\nAwait ($session.${action}) | Out-Null`);
    }
    return readWindowsMedia();
  }
  if (process.platform === "darwin") {
    const command = request.action === "playPause" ? "playpause" : request.action === "next" ? "next track" : request.action === "previous" ? "previous track" : "";
    if (command) await execFileAsync("osascript", ["-e", `tell application "Music" to ${command}`], { windowsHide: true });
    if (request.action === "volume") await execFileAsync("osascript", ["-e", `tell application "Music" to set sound volume to ${Math.round((request.volume ?? 0) * 100)}`], { windowsHide: true });
    return readMacMedia();
  }
  if (request.action === "previous") await playerctl(["previous"]);
  if (request.action === "playPause") await playerctl(["play-pause"]);
  if (request.action === "next") await playerctl(["next"]);
  if (request.action === "volume") {
    const volume = Math.max(0, Math.min(1, request.volume ?? 0));
    await playerctl(["volume", String(volume)]);
  }
  return readMediaStatus();
}

export interface MediaWatcher {
  setActive(active: boolean): void;
  stop(): void;
}

export function watchMedia(onChange: (status: MediaStatusResponse) => void): MediaWatcher {
  let active = false;
  let stopped = false;
  let reading = false;
  let previous = "";
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (!active || stopped || reading) return;
    reading = true;
    try {
      const status = await readMediaStatus();
      const serialized = JSON.stringify(status);
      if (serialized !== previous) {
        previous = serialized;
        onChange(status);
      }
    } finally {
      reading = false;
    }
  };

  const setActive = (nextActive: boolean) => {
    if (stopped || active === nextActive) return;
    active = nextActive;
    if (active) {
      void poll();
      timer = setInterval(() => void poll(), POLL_INTERVAL);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
      previous = "";
    }
  };

  return {
    setActive,
    stop() {
      setActive(false);
      stopped = true;
    }
  };
}
