export const ORQUESTER_GITHUB_REPOSITORY = "sammwyy/orquester";

const GITHUB_RAW_BASE_URL = `https://raw.githubusercontent.com/${ORQUESTER_GITHUB_REPOSITORY}`;
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

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim().replace(/^v/, "");
  return version.length > 0 ? version : null;
}

function normalizeVersions(value: unknown): WorkerVersions {
  if (!value || typeof value !== "object") {
    return { stable: null, unstable: null };
  }

  const versions = value as Record<string, unknown>;
  return {
    stable: normalizeVersion(versions.stable),
    unstable: normalizeVersion(versions.unstable)
  };
}

function normalizeReleaseVersions(value: unknown): ReleaseVersions {
  if (!value || typeof value !== "object") {
    return { client: normalizeVersions(null), worker: normalizeVersions(null) };
  }

  const versions = value as Record<string, unknown>;
  return {
    client: normalizeVersions(versions.client),
    worker: normalizeVersions(versions.worker)
  };
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

export function workerVersionsUrl(branch = "main"): string {
  return `${GITHUB_RAW_BASE_URL}/${encodeURIComponent(branch)}/version.json`;
}

/** Reads the release manifest maintained by the tag publishing workflow. */
export async function getReleaseVersions(fetcher: typeof fetch = fetch): Promise<ReleaseVersions> {
  const response = await fetcher(workerVersionsUrl(), {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Could not load worker versions (${response.status}).`);
  }

  return normalizeReleaseVersions(await response.json());
}

export async function getWorkerVersions(fetcher: typeof fetch = fetch): Promise<WorkerVersions> {
  return (await getReleaseVersions(fetcher)).worker;
}

export async function getClientVersions(fetcher: typeof fetch = fetch): Promise<WorkerVersions> {
  return (await getReleaseVersions(fetcher)).client;
}

export async function getLatestWorkerRelease(
  channel: WorkerReleaseChannel = "stable",
  fetcher: typeof fetch = fetch
): Promise<WorkerRelease | null> {
  const versions = await getWorkerVersions(fetcher);
  const version = versions[channel];
  return version ? { version, channel } : null;
}

export async function getWorkerUpdate(
  currentVersion: string,
  channel: WorkerReleaseChannel = "stable",
  fetcher: typeof fetch = fetch
): Promise<WorkerUpdate> {
  const latest = await getLatestWorkerRelease(channel, fetcher);
  const current = normalizeVersion(currentVersion);
  return {
    latest,
    updateAvailable: Boolean(latest && current && compareVersions(latest.version, current) > 0)
  };
}

export async function getClientUpdate(
  currentVersion: string,
  channel: WorkerReleaseChannel = "stable",
  fetcher: typeof fetch = fetch
): Promise<WorkerUpdate> {
  const versions = await getClientVersions(fetcher);
  const version = versions[channel];
  const latest = version ? { version, channel } : null;
  const current = normalizeVersion(currentVersion);
  return {
    latest,
    updateAvailable: Boolean(latest && current && compareVersions(latest.version, current) > 0)
  };
}

export function workerReleasePage(version: string): string {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) {
    throw new Error("A worker version is required.");
  }
  return `https://github.com/${ORQUESTER_GITHUB_REPOSITORY}/releases/tag/v${encodeURIComponent(normalizedVersion)}`;
}

export function workerPlatformForRuntime(
  platform: string | undefined = typeof navigator === "undefined" ? undefined : navigator.userAgent
): WorkerPlatform | null {
  if (platform === "win32" || platform === "windows" || /windows/i.test(platform ?? "")) return "windows";
  if (platform === "linux" || /linux/i.test(platform ?? "")) return "linux";
  return null;
}

/** Resolves the release asset for an explicit worker version and platform. */
export function resolveWorkerArtifact(version: string, platform: WorkerPlatform): string {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) {
    throw new Error("A worker version is required.");
  }

  const extension = platform === "windows" ? ".exe" : "";
  const asset = `orquester-worker-${normalizedVersion}-${platform}-x86_64${extension}`;
  return `${GITHUB_RELEASES_BASE_URL}/v${encodeURIComponent(normalizedVersion)}/${asset}`;
}

/** Resolves the newest artifact in a channel for the supplied runtime platform. */
export async function resolveLatestWorkerArtifact(
  channel: WorkerReleaseChannel = "stable",
  platform = workerPlatformForRuntime(),
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  if (!platform) return null;
  const release = await getLatestWorkerRelease(channel, fetcher);
  return release ? resolveWorkerArtifact(release.version, platform) : null;
}
