import type { IntegrationStatus } from "@orquester/api";
import { readBatteryStatus } from "./battery";
import { isGitAvailable } from "./git";

export async function getIntegrationAvailability(): Promise<IntegrationStatus[]> {
  const [gitAvailable, battery] = await Promise.all([isGitAvailable(), readBatteryStatus()]);
  return [
    {
      id: "git",
      name: "Git",
      description: "Repository branch, changes, origin and recent commits.",
      enabled: true,
      available: gitAvailable,
      ...(gitAvailable ? {} : { unavailableReason: "Git is not installed on this worker." })
    },
    {
      id: "battery",
      name: "Battery",
      description: "Battery percentage, charging state and power connection.",
      enabled: true,
      available: battery.hasBattery,
      ...(battery.hasBattery ? {} : { unavailableReason: "This worker does not report a battery." })
    },
    {
      id: "system-resources",
      name: "System Resources",
      description: "CPU, memory and the disk containing this worker’s workspaces.",
      enabled: true,
      available: true
    }
  ];
}
