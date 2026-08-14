export const ORQUESTER_GITHUB_REPOSITORY = "sammwyy/orquester";

const GITHUB_API_BASE_URL = `https://api.github.com/repos/${ORQUESTER_GITHUB_REPOSITORY}`;
const GITHUB_RELEASES_BASE_URL = `https://github.com/${ORQUESTER_GITHUB_REPOSITORY}/releases/download`;

export type WorkerReleaseChannel = "stable" | "unstable";
export type WorkerPlatform = "linux" | "windows";

export interface WorkerVersions {
  stable: string | null;
  unstable: string | null;
}

export interface ReleaseVersions {
  client: WorkerVersions;
  worker: WorkerVersions;
}

export interface WorkerRelease {
  version: string;
  channel: WorkerReleaseChannel;
}

export interface WorkerUpdate {
  latest: WorkerRelease | null;
  updateAvailable: boolean;
}

interface GitHubRelease {
  prerelease?: unknown;
  tag_name?: unknown;
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim().replace(/^v/, "");
  return version.length > 0 ? version : null;
}

function compareVersions(left: string, right: string): number {
  const [leftCore, leftPrerelease] = left.split("-", 2);
  const [rightCore, rightPrerelease] = right.split("-", 2);
  const leftParts = leftCore.split(".").map((part) => Number(part));
  const rightParts = rightCore.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }

  if (!leftPrerelease && !rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  return leftPrerelease.localeCompare(rightPrerelease, undefined, { numeric: true });
}

function releaseVersion(release: GitHubRelease, component: "desktop" | "worker"): string | null {
  if (typeof release.tag_name !== "string") return null;
  const prefix = `${component}-v`;
  return release.tag_name.startsWith(prefix) ? normalizeVersion(release.tag_name.slice(component.length + 1)) : null;
}

async function getLatestRelease(
  component: "desktop" | "worker",
  channel: WorkerReleaseChannel,
  fetcher: typeof fetch
): Promise<WorkerRelease | null> {
  const response = await fetcher(`${GITHUB_API_BASE_URL}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`Could not load ${component} releases (${response.status}).`);

  const releases = await response.json() as unknown;
  if (!Array.isArray(releases)) return null;
  const candidates = releases
    .filter((release): release is GitHubRelease => Boolean(release) && typeof release === "object")
    .filter((release) => channel === "unstable" ? release.prerelease === true : release.prerelease !== true)
    .map((release) => releaseVersion(release, component))
    .filter((version): version is string => version !== null);

  const version = candidates.sort(compareVersions).at(-1);
  return version ? { version, channel } : null;
}

export async function getReleaseVersions(fetcher: typeof fetch = fetch): Promise<ReleaseVersions> {
  const [clientStable, clientUnstable, workerStable, workerUnstable] = await Promise.all([
    getLatestRelease("desktop", "stable", fetcher),
    getLatestRelease("desktop", "unstable", fetcher),
    getLatestRelease("worker", "stable", fetcher),
    getLatestRelease("worker", "unstable", fetcher)
  ]);
  return {
    client: { stable: clientStable?.version ?? null, unstable: clientUnstable?.version ?? null },
    worker: { stable: workerStable?.version ?? null, unstable: workerUnstable?.version ?? null }
  };
}

export async function getWorkerVersions(fetcher: typeof fetch = fetch): Promise<WorkerVersions> {
  const [stable, unstable] = await Promise.all([
    getLatestWorkerRelease("stable", fetcher),
    getLatestWorkerRelease("unstable", fetcher)
  ]);
  return { stable: stable?.version ?? null, unstable: unstable?.version ?? null };
}

export async function getClientVersions(fetcher: typeof fetch = fetch): Promise<WorkerVersions> {
  const [stable, unstable] = await Promise.all([
    getLatestDesktopRelease("stable", fetcher),
    getLatestDesktopRelease("unstable", fetcher)
  ]);
  return { stable: stable?.version ?? null, unstable: unstable?.version ?? null };
}

export function getLatestWorkerRelease(channel: WorkerReleaseChannel = "stable", fetcher: typeof fetch = fetch): Promise<WorkerRelease | null> {
  return getLatestRelease("worker", channel, fetcher);
}

export function getLatestDesktopRelease(channel: WorkerReleaseChannel = "stable", fetcher: typeof fetch = fetch): Promise<WorkerRelease | null> {
  return getLatestRelease("desktop", channel, fetcher);
}

export async function getWorkerUpdate(currentVersion: string, channel: WorkerReleaseChannel = "stable", fetcher: typeof fetch = fetch): Promise<WorkerUpdate> {
  const latest = await getLatestWorkerRelease(channel, fetcher);
  const current = normalizeVersion(currentVersion);
  return { latest, updateAvailable: Boolean(latest && current && compareVersions(latest.version, current) > 0) };
}

export async function getClientUpdate(currentVersion: string, channel: WorkerReleaseChannel = "stable", fetcher: typeof fetch = fetch): Promise<WorkerUpdate> {
  const latest = await getLatestDesktopRelease(channel, fetcher);
  const current = normalizeVersion(currentVersion);
  return { latest, updateAvailable: Boolean(latest && current && compareVersions(latest.version, current) > 0) };
}

export function workerReleasePage(version: string): string {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) throw new Error("A worker version is required.");
  return `https://github.com/${ORQUESTER_GITHUB_REPOSITORY}/releases/tag/worker-v${encodeURIComponent(normalizedVersion)}`;
}

export function desktopReleasePage(version: string): string {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) throw new Error("A desktop version is required.");
  return `https://github.com/${ORQUESTER_GITHUB_REPOSITORY}/releases/tag/desktop-v${encodeURIComponent(normalizedVersion)}`;
}

export function workerPlatformForRuntime(platform: string | undefined = typeof navigator === "undefined" ? undefined : navigator.userAgent): WorkerPlatform | null {
  if (platform === "win32" || platform === "windows" || /windows/i.test(platform ?? "")) return "windows";
  if (platform === "linux" || /linux/i.test(platform ?? "")) return "linux";
  return null;
}

export function resolveWorkerArtifact(version: string, platform: WorkerPlatform): string {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) throw new Error("A worker version is required.");
  const extension = platform === "windows" ? ".exe" : "";
  const asset = `orquester-worker-${normalizedVersion}-${platform}-x86_64${extension}`;
  return `${GITHUB_RELEASES_BASE_URL}/worker-v${encodeURIComponent(normalizedVersion)}/${asset}`;
}

export async function resolveLatestWorkerArtifact(channel: WorkerReleaseChannel = "stable", platform = workerPlatformForRuntime(), fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!platform) return null;
  const release = await getLatestWorkerRelease(channel, fetcher);
  return release ? resolveWorkerArtifact(release.version, platform) : null;
}
