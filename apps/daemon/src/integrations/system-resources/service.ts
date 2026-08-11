import { execFile } from "node:child_process";
import { freemem, cpus, loadavg, totalmem } from "node:os";
import { promisify } from "node:util";
import type { ResourceUsage, SystemResourcesResponse } from "@orquester/api";

const execFileAsync = promisify(execFile);
const FAST_INTERVAL = 3_000;
const DISK_INTERVAL = 60_000;

function usage(totalBytes: number, freeBytes: number): ResourceUsage {
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    usedBytes,
    totalBytes,
    freeBytes,
    percentage: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
  };
}

async function readCpu(): Promise<SystemResourcesResponse["cpu"]> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue"
      ]);
      return { percentage: Math.round(Number(stdout.trim()) || 0), cores: cpus().length };
    } catch {
      return { percentage: 0, cores: cpus().length };
    }
  }
  const [load] = loadavg();
  return { percentage: Math.min(100, Math.round((load / Math.max(1, cpus().length)) * 100)), cores: cpus().length };
}

function readMemory(): ResourceUsage {
  return usage(totalmem(), freemem());
}

async function readDisk(workspacesDir: string): Promise<SystemResourcesResponse["disk"]> {
  if (process.platform === "win32") {
    const drive = /^[A-Za-z]:/.exec(workspacesDir)?.[0] ?? "C:";
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='${drive}'\" | Select-Object Size,FreeSpace,DeviceID | ConvertTo-Json -Compress)`
    ]);
    const value = JSON.parse(stdout) as { Size?: number; FreeSpace?: number; DeviceID?: string };
    const total = Number(value.Size) || 0;
    const free = Number(value.FreeSpace) || 0;
    return { ...usage(total, free), mount: value.DeviceID ?? drive, path: workspacesDir };
  }

  const { stdout } = await execFileAsync("df", ["-Pk", workspacesDir]);
  const line = stdout.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) ?? [];
  const total = (Number(line[1]) || 0) * 1024;
  const used = (Number(line[2]) || 0) * 1024;
  const free = (Number(line[3]) || 0) * 1024;
  return { ...usage(total || used + free, free), mount: line[5] ?? "unknown", path: workspacesDir };
}

export async function readSystemResources(workspacesDir: string): Promise<SystemResourcesResponse> {
  const [cpu, disk] = await Promise.all([readCpu(), readDisk(workspacesDir)]);
  return { cpu, memory: readMemory(), disk };
}

export interface SystemResourcesWatcher {
  setActive(active: boolean): void;
  stop(): void;
}

export function watchSystemResources(
  workspacesDir: string,
  onChange: (resources: SystemResourcesResponse) => void
): SystemResourcesWatcher {
  let active = false;
  let stopped = false;
  let reading = false;
  let previous = "";
  let disk: SystemResourcesResponse["disk"] | null = null;
  let nextDiskRead = 0;
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (!active || stopped || reading) return;
    reading = true;
    try {
      const now = Date.now();
      const [cpu] = await Promise.all([readCpu()]);
      if (!disk || now >= nextDiskRead) {
        disk = await readDisk(workspacesDir);
        nextDiskRead = now + DISK_INTERVAL;
      }
      const resources: SystemResourcesResponse = { cpu, memory: readMemory(), disk };
      const serialized = JSON.stringify(resources);
      if (serialized !== previous) {
        previous = serialized;
        onChange(resources);
      }
    } catch {
      // Resource metrics are optional and should never affect the daemon.
    } finally {
      reading = false;
    }
  };

  const setActive = (nextActive: boolean) => {
    if (stopped || active === nextActive) return;
    active = nextActive;
    if (active) {
      void poll();
      timer = setInterval(() => void poll(), FAST_INTERVAL);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
      previous = "";
      disk = null;
      nextDiskRead = 0;
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
