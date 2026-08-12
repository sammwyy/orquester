import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const windowsScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OrquesterPower {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint flags);
}
"@
while ($true) {
  [OrquesterPower]::SetThreadExecutionState(0x80000003) | Out-Null
  Start-Sleep -Seconds 30
}
`;

export async function isKeepAwakeAvailable(): Promise<boolean> {
  if (process.platform === "darwin" || process.platform === "win32") return true;
  if (process.platform !== "linux") return false;
  try {
    await execFileAsync("systemd-inhibit", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export interface KeepAwakeController {
  setEnabled(enabled: boolean): void;
  stop(): void;
}

export function createKeepAwakeController(): KeepAwakeController {
  let processHandle: ReturnType<typeof spawn> | null = null;
  let stopped = false;

  const disable = () => {
    processHandle?.kill();
    processHandle = null;
  };

  return {
    setEnabled(enabled) {
      if (stopped) return;
      disable();
      if (!enabled) return;
      if (process.platform === "darwin") {
        processHandle = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
      } else if (process.platform === "win32") {
        processHandle = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsScript], { stdio: "ignore", windowsHide: true });
      } else if (process.platform === "linux") {
        processHandle = spawn("systemd-inhibit", ["--what=idle:sleep:handle-lid-switch", "--who=Orquester", "--why=Keep Awake integration", "--mode=block", "sleep", "infinity"], { stdio: "ignore" });
      }
      processHandle?.once("exit", () => { processHandle = null; });
    },
    stop() {
      stopped = true;
      disable();
    }
  };
}
