import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { BatteryStatusResponse } from "@orquester/api";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL = 3_000;

const unavailable: BatteryStatusResponse = {
  hasBattery: false,
  charging: false,
  pluggedIn: false
};

async function readLinuxBattery(): Promise<BatteryStatusResponse> {
  const entries = await readdir("/sys/class/power_supply", { withFileTypes: true });
  const batteries = entries.filter((entry) => entry.name.startsWith("BAT"));
  if (batteries.length === 0) return unavailable;

  const values = await Promise.all(batteries.map(async (battery) => {
    const path = `/sys/class/power_supply/${battery.name}`;
    const [capacity, status] = await Promise.all([
      readFile(`${path}/capacity`, "utf8").catch(() => "0"),
      readFile(`${path}/status`, "utf8").catch(() => "Unknown")
    ]);
    return { percentage: Number(capacity.trim()), charging: /charging|full/i.test(status) };
  }));
  const onlineEntries = entries.filter((entry) => !entry.name.startsWith("BAT"));
  const pluggedIn = (await Promise.all(onlineEntries.map(async (entry) =>
    readFile(`/sys/class/power_supply/${entry.name}/online`, "utf8").catch(() => "0")
  ))).some((value) => value.trim() === "1");

  return {
    hasBattery: true,
    percentage: Math.round(values.reduce((sum, value) => sum + value.percentage, 0) / values.length),
    charging: values.some((value) => value.charging),
    pluggedIn
  };
}

async function readMacBattery(): Promise<BatteryStatusResponse> {
  const { stdout } = await execFileAsync("pmset", ["-g", "batt"]);
  const percentage = stdout.match(/(\d+)%/)?.[1];
  if (!percentage) return unavailable;
  return {
    hasBattery: true,
    percentage: Number(percentage),
    charging: /charging|charged/i.test(stdout),
    pluggedIn: /AC Power/i.test(stdout)
  };
}

async function readWindowsBattery(): Promise<BatteryStatusResponse> {
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress"
  ]);
  if (!stdout.trim()) return unavailable;
  const value = JSON.parse(stdout) as { EstimatedChargeRemaining?: number; BatteryStatus?: number } | Array<{ EstimatedChargeRemaining?: number; BatteryStatus?: number }>;
  const batteries = Array.isArray(value) ? value : [value];
  const valid = batteries.filter((battery) => typeof battery.EstimatedChargeRemaining === "number");
  if (valid.length === 0) return unavailable;
  return {
    hasBattery: true,
    percentage: Math.round(valid.reduce((sum, battery) => sum + (battery.EstimatedChargeRemaining ?? 0), 0) / valid.length),
    charging: valid.some((battery) => battery.BatteryStatus === 2),
    pluggedIn: valid.some((battery) => [2, 6, 7, 8, 9, 11].includes(battery.BatteryStatus ?? 0))
  };
}

export async function readBatteryStatus(): Promise<BatteryStatusResponse> {
  try {
    if (process.platform === "linux") return await readLinuxBattery();
    if (process.platform === "darwin") return await readMacBattery();
    if (process.platform === "win32") return await readWindowsBattery();
  } catch {
    return unavailable;
  }
  return unavailable;
}

export interface BatteryWatcher {
  setActive(active: boolean): void;
  stop(): void;
}

export function watchBattery(onChange: (status: BatteryStatusResponse) => void): BatteryWatcher {
  let previous = "";
  let stopped = false;
  let reading = false;
  let active = false;
  let timer: NodeJS.Timeout | null = null;

  const poll = async () => {
    if (stopped || reading) return;
    reading = true;
    try {
      const status = await readBatteryStatus();
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
