import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NetworkPort, NetworkStatusResponse, SessionSummary } from "@orquester/api";

const execFileAsync = promisify(execFile);

function descendantPids(sessions: SessionSummary[]): Map<number, string> {
  const roots = new Map<number, string>([[process.pid, ""]]);
  for (const session of sessions) if (session.pid) roots.set(session.pid, session.id);
  return roots;
}

async function posixPorts(sessions: SessionSummary[]): Promise<NetworkPort[]> {
  const { stdout: processOutput } = await execFileAsync("ps", ["-eo", "pid=,ppid=,comm="]);
  const processes = processOutput.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), name: match[3] } : null;
  }).filter((item): item is { pid: number; ppid: number; name: string } => item !== null);
  const allowed = descendantPids(sessions);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!allowed.has(process.pid) && allowed.has(process.ppid)) {
        allowed.set(process.pid, allowed.get(process.ppid) ?? "");
        changed = true;
      }
    }
  }
  const names = new Map(processes.map((item) => [item.pid, item.name]));
  const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpctn"]).catch(() => ({ stdout: "" }));
  const ports: NetworkPort[] = [];
  let current: Partial<NetworkPort> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      if (current.pid && current.port && current.pid !== process.pid && allowed.has(current.pid)) {
        ports.push({ protocol: "tcp", address: current.address ?? "*", port: current.port, pid: current.pid, process: names.get(current.pid) ?? "process", sessionId: allowed.get(current.pid) || undefined });
      }
      current = { pid: Number(line.slice(1)) };
    } else if (line.startsWith("c")) current.process = line.slice(1);
    else if (line.startsWith("n")) {
      const match = line.slice(1).match(/^(.*):(\d+)$/);
      if (match) { current.address = match[1]; current.port = Number(match[2]); }
    }
  }
  if (current.pid && current.port && current.pid !== process.pid && allowed.has(current.pid)) {
    ports.push({ protocol: "tcp", address: current.address ?? "*", port: current.port, pid: current.pid, process: current.process ?? names.get(current.pid) ?? "process", sessionId: allowed.get(current.pid) || undefined });
  }
  return ports;
}

async function windowsPorts(sessions: SessionSummary[]): Promise<NetworkPort[]> {
  const roots = [process.pid, ...sessions.flatMap((session) => session.pid ? [session.pid] : [])].join(",");
  const script = `$roots=@(${roots}); $all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name; $allowed=[Collections.Generic.HashSet[int]]::new(); foreach($root in $roots){[void]$allowed.Add($root)}; $changed=$true; while($changed){$changed=$false; foreach($p in $all){if(!$allowed.Contains($p.ProcessId) -and $allowed.Contains($p.ParentProcessId)){[void]$allowed.Add($p.ProcessId);$changed=$true}}}; Get-NetTCPConnection -State Listen | Where-Object {$allowed.Contains($_.OwningProcess) -and $_.OwningProcess -ne ${process.pid}} | ForEach-Object {$connection=$_; $p=$all | Where-Object {$_.ProcessId -eq $connection.OwningProcess}; [pscustomobject]@{Address=$connection.LocalAddress;Port=$connection.LocalPort;Pid=$connection.OwningProcess;Process=$p.Name}} | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { maxBuffer: 512 * 1024, windowsHide: true }).catch(() => ({ stdout: "" }));
  if (!stdout.trim()) return [];
  const values = JSON.parse(stdout) as { Address: string; Port: number; Pid: number; Process?: string } | { Address: string; Port: number; Pid: number; Process?: string }[];
  return (Array.isArray(values) ? values : [values]).map((value) => ({ protocol: "tcp", address: value.Address, port: Number(value.Port), pid: Number(value.Pid), process: value.Process ?? "process" }));
}

export async function readNetworkStatus(sessions: SessionSummary[]): Promise<NetworkStatusResponse> {
  try {
    return { ports: process.platform === "win32" ? await windowsPorts(sessions) : await posixPorts(sessions) };
  } catch {
    return { ports: [] };
  }
}

export async function killNetworkProcess(pid: number, sessions: SessionSummary[]): Promise<void> {
  const status = await readNetworkStatus(sessions);
  if (!status.ports.some((port) => port.pid === pid)) throw new Error("Process is not an Orquester child or no longer owns a listening port.");
  if (process.platform === "win32") await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else process.kill(pid, "SIGTERM");
}

export interface NetworkingWatcher {
  setActive(active: boolean): void;
  stop(): void;
}

export function watchNetworking(getSessions: () => SessionSummary[], onChange: (status: NetworkStatusResponse) => void): NetworkingWatcher {
  let active = false;
  let stopped = false;
  let reading = false;
  let previous = "";
  let timer: NodeJS.Timeout | null = null;
  const poll = async () => {
    if (!active || stopped || reading) return;
    reading = true;
    try {
      const status = await readNetworkStatus(getSessions());
      const serialized = JSON.stringify(status);
      if (serialized !== previous) { previous = serialized; onChange(status); }
    } finally { reading = false; }
  };
  const setActive = (next: boolean) => {
    if (stopped || active === next) return;
    active = next;
    if (active) { void poll(); timer = setInterval(() => void poll(), 3_000); }
    else if (timer) { clearInterval(timer); timer = null; previous = ""; }
  };
  return { setActive, stop() { setActive(false); stopped = true; } };
}
