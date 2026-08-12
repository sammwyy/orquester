import type { IntegrationStatus } from "@orquester/api";
import { readBatteryStatus } from "./battery";
import { isGitAvailable } from "./git";
import { isMediaAvailable } from "./media";
import { isKeepAwakeAvailable } from "./keep-awake";

export async function getIntegrationAvailability(): Promise<IntegrationStatus[]> {
  const [gitAvailable, battery, mediaAvailable, keepAwakeAvailable] = await Promise.all([isGitAvailable(), readBatteryStatus(), isMediaAvailable(), isKeepAwakeAvailable()]);
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
    },
    {
      id: "keep-awake",
      name: "Keep Awake",
      description: "Prevent this worker from sleeping or becoming idle while enabled.",
      enabled: true,
      available: keepAwakeAvailable,
      ...(keepAwakeAvailable ? {} : { unavailableReason: "This worker cannot control its idle or sleep state." })
    },
    {
      id: "networking",
      name: "Networking",
      description: "Ports exposed by Orquester child processes and their sessions.",
      enabled: true,
      available: true
    }
  ];
}
