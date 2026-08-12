import type { IntegrationStatus } from "@orquester/api";
import { readBatteryStatus } from "./battery";
import { isGitAvailable } from "./git";
import { isMediaAvailable } from "./media";

export async function getIntegrationAvailability(): Promise<IntegrationStatus[]> {
  const [gitAvailable, battery, mediaAvailable] = await Promise.all([isGitAvailable(), readBatteryStatus(), isMediaAvailable()]);
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
    },
    {
      id: "media",
      name: "Media",
      description: "Control the media session playing on this worker.",
      enabled: true,
      available: mediaAvailable,
      ...(mediaAvailable ? {} : { unavailableReason: "No supported media session is available on this worker." })
    }
  ];
}
