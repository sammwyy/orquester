import type {
  OpenResult,
  RegistryActionResult,
  RegistryAuthInfo,
  RegistryEntry,
  RegistryKind,
  RegistryQuota,
  RegistryResponse
} from "@orquester/api";
import { REGISTRY, type RegistryEntryDef } from "@orquester/registry";
import { exec, spawn } from "node:child_process";
import * as pty from "node-pty";
import { EventEmitter } from "node:events";
import { accessSync, constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_DEFS, AGENT_INTEGRATIONS } from "./integrations/agents";
import { HOST_BROWSERS, HOST_FILE_EXPLORERS, HOST_IDES } from "./host-registry";
import { unsupportedQuota, type AgentCommandContext } from "./integrations/agents/types";

/** Runtime shape after token expansion. */
interface RegistryDef {
  id: string;
  name: string;
  kind: RegistryKind;
  bin: string[];
  binDeps?: string[];
  enabled?: boolean;
  versionFlag?: string;
  installCmd?: string;
  updateCmd?: string;
  websiteUrl?: string;
}

interface RuntimeRegistryEntry {
  id: string;
  name: string;
  kind: RegistryKind;
  bin: string[];
  binDeps?: string[];
  enabled: boolean;
  resolvedBin?: string;
  versionFlag?: string;
  version?: string;
  installCmd?: string;
  updateCmd?: string;
  websiteUrl?: string;
  installState: RegistryEntry["installState"];
  installError?: string;
}

function expand(tokens: readonly string[]): string[] {
  const e = process.env;
  const HOME = e.HOME || e.USERPROFILE || "";
  const LOCAL = e.LOCALAPPDATA || "";
  const PF = e.ProgramFiles || e["ProgramFiles(x86)"] || "";
  return tokens
    .filter(Boolean)
    .map((t) =>
      t
        .replace(/\$LOCALAPPDATA/g, LOCAL)
        .replace(/\$PROGRAMFILES/g, PF)
        .replace(/\$HOME/g, HOME)
    );
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBin(cands: string[]): string | undefined {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const c of cands) {
    if (isAbsolute(c) && isExecutable(c)) return c;
    for (const d of dirs) {
      for (const x of exts) {
        const f = join(d, c + x);
        if (isExecutable(f)) return f;
      }
    }
  }
  return undefined;
}

function osOpener(): string[] {
  if (process.platform === "win32") return ["explorer"];
  if (process.platform === "darwin") return ["open"];
  return ["xdg-open"];
}

/** Materialize static defs (from @orquester/registry) into runtime defs. */
function materialize(list: readonly RegistryEntryDef[]): RegistryDef[] {
  return list.map((s) => {
    const expanded = expand(s.bin);
    const bin = s.bin.length === 0 && (s.kind === "file-explorer" || s.kind === "browser") ? osOpener() : expanded;
    const d: RegistryDef = { id: s.id, name: s.name, kind: s.kind, bin };
    if (s.versionFlag) d.versionFlag = s.versionFlag;
    if (s.installCmd) d.installCmd = s.installCmd;
    if (s.updateCmd) d.updateCmd = s.updateCmd;
    if (s.binDeps) d.binDeps = [...s.binDeps];
    if (s.websiteUrl) d.websiteUrl = s.websiteUrl;
    return d;
  });
}

function publicEntry(entry: RuntimeRegistryEntry): RegistryEntry {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    enabled: entry.enabled,
    version: entry.version,
    canInstall: Boolean(entry.installCmd),
    canUpdate: Boolean(entry.updateCmd),
    installCommand: entry.installCmd,
    websiteUrl: entry.websiteUrl,
    missingDependencies: (entry.binDeps ?? []).filter((dependency) => !resolveBin([dependency])),
    installState: entry.installState,
    installError: entry.installError
  };
}

const DEFAULT_SHELLS: RegistryDef[] = materialize(REGISTRY.shells as readonly RegistryEntryDef[]);
const DEFAULT_AGENTS: RegistryDef[] = materialize(AGENT_DEFS);
const DEFAULT_IDES: RegistryDef[] = materialize(HOST_IDES);
const DEFAULT_FILE_EXPLORERS: RegistryDef[] = materialize(HOST_FILE_EXPLORERS);
const DEFAULT_BROWSERS: RegistryDef[] = materialize(HOST_BROWSERS);

/** The platform's generic "open this" command. */
function osOpenerForKind(kind: RegistryKind): string[] {
  if (kind === "file-explorer" || kind === "browser") return osOpener();
  return [];
}

/**
 * Owns the catalog of launchable shells, agents, IDEs, file explorers and
 * browsers. Resolves each entry's binary against PATH (and common install
 * paths) once and caches it; an entry is `enabled` only when a candidate bin
 * was found (and it was not explicitly disabled).
 */
export class RegistryService {
  private entries = new Map<string, RuntimeRegistryEntry>();
  private quotas = new Map<string, RegistryQuota>();
  private quotaRequests = new Map<string, Promise<RegistryQuota>>();
  private quotaTimer: ReturnType<typeof setInterval> | null = null;
  private eventClientCount = 0;
  private quotaWorkers: Record<string, boolean>;
  private elevatedInputs = new Map<string, { write: (password: string) => void; cancel: () => void }>();
  /** Emits "changed" with the updated RegistryEntry (broadcast to clients). */
  readonly events = new EventEmitter();
  /** Emits "changed" with a refreshed RegistryQuota. */
  readonly quotaEvents = new EventEmitter();
  readonly installEvents = new EventEmitter();

  constructor(private readonly daemonDir: string, quotaWorkers: Record<string, boolean> = {}) {
    this.quotaWorkers = quotaWorkers;
  }

  async init(): Promise<void> {
    const defs: RegistryDef[] = [
      ...DEFAULT_SHELLS,
      ...DEFAULT_AGENTS,
      ...DEFAULT_IDES,
      ...DEFAULT_FILE_EXPLORERS,
      ...DEFAULT_BROWSERS,
      ...(await this.loadOverrides("shells.json", "shell")),
      ...(await this.loadOverrides("agents.json", "agent")),
      ...(await this.loadOverrides("ides.json", "ide")),
      ...(await this.loadOverrides("file-explorers.json", "file-explorer")),
      ...(await this.loadOverrides("browsers.json", "browser"))
    ];

    this.entries.clear();
    this.quotas.clear();
    for (const def of defs) {
      this.entries.set(def.id, this.resolveDef(def));
    }
    // Detect installed agent versions in the background (cached); each result
    // patches the entry and emits "changed".
    void this.detectVersions();
  }

  list(): RegistryResponse {
    const byKind = (kind: RegistryKind) =>
      [...this.entries.values()]
        .filter((entry) => entry.kind === kind)
        .map((entry) => publicEntry(entry));
    return {
      shells: byKind("shell"),
      agents: byKind("agent"),
      ides: byKind("ide"),
      fileExplorers: byKind("file-explorer"),
      browsers: byKind("browser")
    };
  }

  get(id: string): RuntimeRegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** Launch an ide/file-explorer/browser on a path (fire-and-forget). */
  openTarget(targetId: string, path: string): OpenResult {
    const entry = this.entries.get(targetId);
    if (!entry?.resolvedBin || !entry.enabled) {
      return { ok: false, message: `Target "${targetId}" is not available.` };
    }

    const arg = entry.kind === "browser" ? pathToFileURL(path).href : path;
    try {
      const child = spawn(entry.resolvedBin, [arg], {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32"
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "spawn failed" };
    }
  }

  /** Start an install (background); status flows via `events`. Returns immediately. */
  install(id: string, elevated = false): { started: boolean } {
    const entry = this.entries.get(id);
    if (!entry?.installCmd || entry.installState === "installing") {
      return { started: false };
    }
    this.runManaged(id, elevated ? elevateCommand(entry.installCmd) : entry.installCmd, elevated);
    return { started: true };
  }

  provideInstallPassword(id: string, password: string): boolean {
    const write = this.elevatedInputs.get(id);
    if (!write || !password) return false;
    write.write(password);
    return true;
  }

  cancelInstallPassword(id: string): boolean {
    const input = this.elevatedInputs.get(id);
    if (!input) return false;
    this.elevatedInputs.delete(id);
    input.cancel();
    return true;
  }

  /** Start an update (background); same semantics as install. */
  update(id: string): { started: boolean } {
    const entry = this.entries.get(id);
    if (!entry?.updateCmd || entry.installState === "installing") {
      return { started: false };
    }
    this.runManaged(id, entry.updateCmd);
    return { started: true };
  }

  /** Run the live version flag for an entry (manual endpoint). */
  async version(id: string): Promise<RegistryActionResult> {
    const entry = this.entries.get(id);
    const integration = entry?.kind === "agent" ? AGENT_INTEGRATIONS.get(id) : undefined;
    if (!entry?.resolvedBin || (!entry.versionFlag && !integration?.getVersion)) {
      return { ok: false, exitCode: -1, output: "No bin or version flag for this entry." };
    }
    if (integration?.getVersion) {
      const version = await integration.getVersion({
        bin: entry.resolvedBin,
        call: (args) => runExecutable(entry.resolvedBin as string, args)
      });
      return version
        ? { ok: true, exitCode: 0, output: version }
        : { ok: false, exitCode: 1, output: "The provider did not return a version." };
    }
    const versionFlag = entry.versionFlag;
    if (!versionFlag) {
      return { ok: false, exitCode: -1, output: "No version flag for this entry." };
    }
    return runExecutable(entry.resolvedBin, [versionFlag]);
  }

  /** Ask the agent integration for account/provider quota without exposing credentials. */
  async quota(id: string): Promise<RegistryQuota> {
    const cached = this.quotas.get(id);
    if (cached) return cached;
    if (!this.isQuotaWorkerEnabled(id)) {
      const entry = this.entries.get(id);
      return unsupportedQuota(id, entry?.name ?? id, "Quota worker is disabled for this provider.");
    }
    return this.refreshQuota(id);
  }

  setEventClientCount(count: number): void {
    this.eventClientCount = count;
    if (count > 0 && !this.quotaTimer) {
      void this.refreshAllQuotas();
      this.quotaTimer = setInterval(() => void this.refreshAllQuotas(), 30_000);
    } else if (count === 0 && this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
  }

  setQuotaWorkers(workers: Record<string, boolean>): void {
    this.quotaWorkers = workers;
    this.setEventClientCount(this.eventClientCount);
  }

  private async refreshAllQuotas(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()]
        .filter((entry) => entry.kind === "agent" && entry.enabled)
        .filter((entry) => this.isQuotaWorkerEnabled(entry.id))
        .map((entry) => this.refreshQuota(entry.id))
    );
  }

  private isQuotaWorkerEnabled(id: string): boolean {
    return this.quotaWorkers[id] !== false;
  }

  private async refreshQuota(id: string): Promise<RegistryQuota> {
    const pending = this.quotaRequests.get(id);
    if (pending) return pending;
    const request = this.readQuota(id)
      .then((quota) => {
        // A transient read failure shouldn't blank out data that loaded fine
        // before: keep serving the last good quota until a read actually succeeds.
        const cached = this.quotas.get(id);
        const next = !quota.supported && cached?.supported ? cached : quota;
        this.quotas.set(id, next);
        this.quotaEvents.emit("changed", { ...next });
        return next;
      })
      .finally(() => this.quotaRequests.delete(id));
    this.quotaRequests.set(id, request);
    return request;
  }

  private async readQuota(id: string): Promise<RegistryQuota> {
    const entry = this.entries.get(id);
    const integration = entry?.kind === "agent" ? AGENT_INTEGRATIONS.get(id) : undefined;
    if (!entry || entry.kind !== "agent") {
      return unsupportedQuota(id, entry?.name ?? id);
    }
    if (!entry.resolvedBin || !entry.enabled) {
      return {
        id,
        provider: entry.name,
        auth: { status: "unknown", message: "The agent is not installed or cannot be resolved." },
        supported: false,
        fetchedAt: new Date().toISOString(),
        windows: [],
        message: "The agent is not installed or cannot be resolved."
      };
    }
    if (!integration?.getQuota) {
      return unsupportedQuota(id, entry.name);
    }
    try {
      const context: AgentCommandContext = {
        bin: entry.resolvedBin,
        call: (args) => runExecutable(entry.resolvedBin as string, args),
        callInteractive: (args, stopWhen) => runInteractive(entry.resolvedBin as string, args, stopWhen),
        appServerCall: (method, params) => runAppServerCall(entry.resolvedBin as string, method, params)
      };
      const quota = await integration.getQuota(context);
      if (integration.getAuthStatus) {
        quota.auth = await integration.getAuthStatus(context);
      }
      return quota;
    } catch {
      return {
        id,
        provider: entry.name,
        auth: { status: "unknown", message: "Authentication status could not be read." },
        supported: false,
        fetchedAt: new Date().toISOString(),
        windows: [],
        message: "The provider quota could not be read."
      };
    }
  }

  /** Run an install/update command, broadcasting status; re-resolve on success. */
  private runManaged(id: string, command: string, elevated = false): void {
    this.patch(id, { installState: "installing", installError: undefined });
    const resultPromise = elevated
      ? runElevated(command, (input) => {
          this.elevatedInputs.set(id, input);
          this.installEvents.emit("sudo.required", { id });
        })
      : run(command);
    void resultPromise.then((result) => {
      this.elevatedInputs.delete(id);
      if (result.ok) {
        const entry = this.entries.get(id);
        const resolvedBin = entry ? resolveBin(entry.bin) : undefined;
        this.patch(id, {
          resolvedBin,
          enabled: Boolean(resolvedBin) && (entry?.binDeps ?? []).every((dependency) => Boolean(resolveBin([dependency]))),
          installState: "idle",
          installError: undefined,
          version: undefined
        });
        void this.detectVersion(id);
      } else {
        this.patch(id, { installState: "error", installError: result.output.slice(-4000) });
      }
    });
  }

  private patch(id: string, partial: Partial<RuntimeRegistryEntry>): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    Object.assign(entry, partial);
    this.events.emit("changed", publicEntry(entry));
  }

  private async detectVersions(): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter((e) => e.kind === "agent" && e.enabled && e.versionFlag)
        .map((e) => this.detectVersion(e.id))
    );
  }

  private async detectVersion(id: string): Promise<void> {
    const entry = this.entries.get(id);
    const integration = entry?.kind === "agent" ? AGENT_INTEGRATIONS.get(id) : undefined;
    if (!entry?.resolvedBin || (!entry.versionFlag && !integration?.getVersion)) {
      return;
    }
    if (integration?.getVersion) {
      const version = await integration.getVersion({
        bin: entry.resolvedBin,
        call: (args) => runExecutable(entry.resolvedBin as string, args)
      });
      if (version) {
        this.patch(id, { version });
      }
      return;
    }
    const versionFlag = entry.versionFlag;
    if (!versionFlag) {
      return;
    }
    const result = await runExecutable(entry.resolvedBin, [versionFlag]);
    if (result.ok) {
      const version = result.output.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 80);
      if (version) this.patch(id, { version });
    }
  }

  private resolveDef(def: RegistryDef): RuntimeRegistryEntry {
    const resolvedBin = resolveBin(def.bin);
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      bin: def.bin,
      resolvedBin,
      enabled: Boolean(resolvedBin) && (def.binDeps ?? []).every((dependency) => Boolean(resolveBin([dependency]))) && def.enabled !== false,
      versionFlag: def.versionFlag,
      installCmd: def.installCmd,
      updateCmd: def.updateCmd,
      binDeps: def.binDeps,
      websiteUrl: def.websiteUrl,
      installState: "idle"
    };
  }

  /** Load and normalize <daemonDir>/<file> (array of partial defs), if present. */
  private async loadOverrides(file: string, kind: RegistryKind): Promise<RegistryDef[]> {
    try {
      const raw = await readFile(join(this.daemonDir, file), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => normalizeDef(item, kind))
        .filter((def): def is RegistryDef => def !== null);
    } catch {
      return [];
    }
  }
}

const KINDS: RegistryKind[] = ["shell", "agent", "ide", "file-explorer", "browser"];

function normalizeDef(item: unknown, defaultKind: RegistryKind): RegistryDef | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const obj = item as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : undefined;
  const name = typeof obj.name === "string" ? obj.name : undefined;
  const bin =
    typeof obj.bin === "string"
      ? [obj.bin]
      : Array.isArray(obj.bin)
        ? obj.bin.filter((b): b is string => typeof b === "string")
        : [];

  if (!id || !name || bin.length === 0) {
    return null;
  }

  return {
    id,
    name,
    kind: KINDS.includes(obj.kind as RegistryKind) ? (obj.kind as RegistryKind) : defaultKind,
    bin,
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : undefined,
    versionFlag: typeof obj.versionFlag === "string" ? obj.versionFlag : undefined,
    installCmd: typeof obj.installCmd === "string" ? obj.installCmd : undefined,
    updateCmd: typeof obj.updateCmd === "string" ? obj.updateCmd : undefined,
    binDeps: Array.isArray(obj.binDeps) ? obj.binDeps.filter((dependency): dependency is string => typeof dependency === "string") : undefined,
    websiteUrl: typeof obj.websiteUrl === "string" ? obj.websiteUrl : undefined
  };
}

/** Run a shell command to completion, capturing combined output (capped). */
function run(command: string): Promise<RegistryActionResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`.slice(0, 64_000);
      const exitCode = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ ok: !error, exitCode, output });
    });
  });
}

function runExecutable(file: string, args: readonly string[]): Promise<RegistryActionResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      // shell:true avoids EINVAL when file is a Windows .cmd/.bat shim.
      child = spawn(file, [...args], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    } catch (error) {
      resolve({ ok: false, exitCode: 1, output: error instanceof Error ? error.message : "spawn failed" });
      return;
    }
    let settled = false;
    let stdout = "";
    let stderr = "";
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout = `${stdout}${chunk.toString()}`.slice(0, 64_000);
      else stderr = `${stderr}${chunk.toString()}`.slice(0, 64_000);
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    const finish = (result: RegistryActionResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, exitCode: 124, output: "Command timed out." });
    }, 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      finish({ ok: false, exitCode: 1, output: error.message.slice(0, 64_000) });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const output = `${stdout}${stderr}`.slice(0, 64_000);
      finish({ ok: code === 0, exitCode: code ?? 1, output });
    });
  });
}

function elevateCommand(command: string): string {
  if (process.platform === "win32") {
    const escaped = command.replace(/'/g, "''");
    return `powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c','${escaped}' -Verb RunAs -Wait"`;
  }
  return `sudo -S -p '[ORQUESTER_SUDO_PROMPT]' sh -c ${shellQuote(command)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runElevated(
  command: string,
  onPrompt: (input: { write: (password: string) => void; cancel: () => void }) => void
): Promise<RegistryActionResult> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "/bin/sh", process.platform === "win32" ? ["/c", command] : ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    let prompted = false;
    const finish = (result: RegistryActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, exitCode: 124, output: "Command timed out." });
    }, 10 * 60_000);
    child.stdout?.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-64_000); });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-64_000);
      if (!prompted && stderr.includes("[ORQUESTER_SUDO_PROMPT]")) {
        prompted = true;
        onPrompt({
          write: (password) => child.stdin?.write(`${password}\n`),
          cancel: () => child.kill()
        });
      }
    });
    child.once("error", (error) => finish({ ok: false, exitCode: 1, output: error.message }));
    child.once("close", (code) => {
      const output = `${stdout}${stderr}`.replace(/\[ORQUESTER_SUDO_PROMPT\]/g, "").slice(0, 64_000);
      finish({ ok: code === 0, exitCode: code ?? 1, output });
    });
  });
}

function runInteractive(file: string, args: readonly string[], stopWhen?: RegExp): Promise<RegistryActionResult> {
  return new Promise((resolve) => {
    const child = pty.spawn(file, [...args], {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      // Avoids node-pty's "AttachConsole failed" crash on kill (Windows).
      ...(process.platform === "win32" ? { useConptyDll: true } : {})
    });
    let output = "";
    let settled = false;
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolve({ ok: exitCode === 0, exitCode, output: output.slice(0, 64_000) });
    };
    const timeout = setTimeout(() => finish(124), 20_000);
    child.onData((chunk) => {
      output = `${output}${chunk}`.slice(-64_000);
      if (stopWhen?.test(output)) {
        child.write("\u0003");
        setTimeout(() => finish(0), 250);
      }
    });
    child.onExit(({ exitCode }) => finish(exitCode ?? 1));
  });
}

function runAppServerCall(file: string, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "ignore"],
        shell: process.platform === "win32"
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("spawn failed"));
      return;
    }
    let buffer = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      callback();
    };
    const timeout = setTimeout(() => finish(() => reject(new Error("Codex app-server timed out."))), 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
            if (message.id === 2) {
              if (message.error) finish(() => reject(new Error("Codex app-server request failed.")));
              else finish(() => resolve(message.result));
            }
          } catch {
            // Ignore non-JSON output; app-server messages are newline-delimited JSON.
          }
        }
        newline = buffer.indexOf("\n");
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    const send = (message: Record<string, unknown>) => child.stdin?.write(`${JSON.stringify(message)}\n`);
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "orquester", version: "0.0.0" },
        capabilities: { experimentalApi: true }
      }
    });
    setTimeout(() => {
      if (settled) return;
      send({ method: "initialized" });
      send({ method, id: 2, params });
    }, 150);
  });
}
