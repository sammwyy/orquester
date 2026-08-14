import { useMemo } from "react";
import { create } from "zustand";
import type { AgentConversationSummary, BatteryStatusResponse, GitStatusResponse, IntegrationStatus, MediaControlRequest, MediaStatusResponse, NetworkStatusResponse, ProcessManagerResponse, RegistryQuota, SystemResourcesResponse } from "@orquester/api";
import { ApiClient, ApiError } from "../lib/api-client";
import { createTransporter } from "../lib/transporters";
import { toRemoteConfig, toUiConnection } from "../lib/connections";
import { clearStoredHash, deriveAuthHash, loadStoredHash, storeHash } from "../lib/auth";
import type { AppConfigAdapter } from "../lib/app-config";
import type { HttpClient } from "../lib/http-client";
import type { Transporter } from "../lib/transporter";
import { workspaceService } from "../services";
import { clientStateKey, loadClientUiState, saveClientUiState, type ClientUiState } from "../lib/client-state";
import type {
  ConnectionStatus,
  EventMessage,
  ProjectSummary,
  RecentProjectSummary,
  ProjectTemplateSummary,
  RegistryEntry,
  RegistryKind,
  RegistryResponse,
  SessionSummary,
  ThemeMode,
  UiConnection,
  WindowCapabilities,
  WorkspaceSummary
} from "../types";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const EMPTY_REGISTRY: RegistryResponse = {
  shells: [],
  agents: [],
  ides: [],
  fileExplorers: [],
  browsers: []
};

/** Replace a registry entry (matched by id within its kind) with a fresh copy. */
function applyRegistryEntry(registry: RegistryResponse, entry: RegistryEntry): RegistryResponse {
  const key = (
    {
      shell: "shells",
      agent: "agents",
      ide: "ides",
      "file-explorer": "fileExplorers",
      browser: "browsers"
    } as const
  )[entry.kind];
  const list = registry[key];
  const index = list.findIndex((e) => e.id === entry.id);
  const next = index === -1 ? [...list, entry] : list.map((e) => (e.id === entry.id ? entry : e));
  return { ...registry, [key]: next };
}

function applyOptimisticMediaControl(status: MediaStatusResponse | null, request: MediaControlRequest): MediaStatusResponse | null {
  if (!status?.available) return status;
  if (request.action === "playPause" && status.state !== "stopped") {
    return { ...status, state: status.state === "playing" ? "paused" : "playing" };
  }
  if (request.action === "volume" && typeof request.volume === "number") {
    return { ...status, volume: Math.min(1, Math.max(0, request.volume)), volumeAvailable: true };
  }
  return status;
}

/** Module-level handle so we can drop the events subscription on reconnect. */
let eventsUnsubscribe: (() => void) | null = null;
/** Generation guard so a stale events stream's onEnd doesn't trigger reconnect. */
let eventsGen = 0;
/** Periodic health probe that detects a dropped/restarted transport. */
let healthTimer: ReturnType<typeof setInterval> | null = null;
/** Guards against overlapping reconnect loops. */
let reconnecting = false;

function stopHealthProbe(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

/** Intentionally drop the events subscription (bumps gen so its onEnd is ignored). */
function closeEvents(): void {
  eventsGen += 1;
  eventsUnsubscribe?.();
  eventsUnsubscribe = null;
}

/** Host-provided connection wiring, set once via initConnections(). */
interface ConnectionSetup {
  localConnection: UiConnection;
  /** Injected transport for the local connection (desktop unix socket). */
  localTransporter?: Transporter;
  /** Custom HTTP client for remote transporters (rarely needed). */
  httpClient?: HttpClient;
  /**
   * App-config persistence. Web injects a localStorage adapter; desktop omits
   * it, so app config is read/written on the daemon (app.json), while remotes
   * always live on the daemon (shared).
   */
  appConfigAdapter?: AppConfigAdapter;
  /** Fallback for useTitlebar when app config doesn't specify it. */
  defaultUseTitlebar: boolean;
}

let setup: ConnectionSetup | null = null;

/**
 * The "home" daemon (the initial/local connection). App config and the remote
 * server list are persisted here so every client of this daemon shares them,
 * independent of which connection is currently active.
 */
let homeApi: ApiClient | null = null;

export interface UiAppConfig {
  useTitlebar: boolean;
  runInBackground: boolean;
  startWorkerOnLogin: boolean;
  /** Sidebar alpha while transparent (0.3–1). */
  sidebarOpacity: number;
  glassSidebar: boolean;
  /** Titlebar and main chrome alpha while transparent (0.3–1). */
  titlebarOpacity: number;
  glassTitlebar: boolean;
  roundedWindow: boolean;
  /** Colour scheme id (see COLOR_SCHEMES). */
  theme: string;
  themeMode: ThemeMode;
  quotaResetFormat: "relative" | "absolute" | "both";
  showQuotaMenu: boolean;
  searchForUpdates: boolean;
  updateChannel: "stable" | "nightly";
  setupComplete: boolean;
  localWorkerInstalled: boolean;
}

const DEFAULT_APP_CONFIG: UiAppConfig = {
  useTitlebar: false,
  runInBackground: false,
  startWorkerOnLogin: false,
  sidebarOpacity: 0.85,
  glassSidebar: false,
  titlebarOpacity: 0.85,
  glassTitlebar: false,
  roundedWindow: true,
  theme: "mono",
  themeMode: "dark",
  quotaResetFormat: "relative",
  showQuotaMenu: false,
  searchForUpdates: true,
  updateChannel: "stable",
  setupComplete: false,
  localWorkerInstalled: false
};

/** Persist the remote-server list to the home daemon (shared across clients). */
async function persistRemotes(connections: UiConnection[]): Promise<void> {
  const remotes = connections.filter((c) => c.kind === "remote").map(toRemoteConfig);
  if (setup?.appConfigAdapter?.saveRemotes) {
    await setup.appConfigAdapter.saveRemotes(remotes).catch(() => undefined);
    return;
  }
  await homeApi
    ?.saveRemotes(remotes)
    .catch(() => undefined);
}

/** Rebuild an ApiClient for the same connection but with a bearer credential. */
function apiWithPassword(api: ApiClient, password: string): ApiClient {
  const connection: UiConnection = { ...api.connection, password };
  return new ApiClient(connection, buildTransporter(connection));
}

/** Build the transporter for a connection: local uses the injected one. */
function buildTransporter(connection: UiConnection): Transporter {
  if (setup && connection.id === setup.localConnection.id && setup.localTransporter) {
    return setup.localTransporter;
  }
  return createTransporter(connection, { httpClient: setup?.httpClient });
}

/** A built-in, client-local (non-PTY) tool. */
export type ToolKind = "files" | "git" | "rest-client";

/** A client-local, non-PTY tab (e.g. the file browser or the git tree). */
export interface ToolTab {
  id: string;
  projectPath: string;
  kind: ToolKind;
  title: string;
}

/** A tab in the current project: a daemon session or a local tool tab. */
export type ProjectTab =
  | { id: string; type: "session"; session: SessionSummary }
  | { id: string; type: ToolKind; title: string };

const TOOL_TITLES: Record<ToolKind, string> = {
  files: "Files",
  git: "Git Tree",
  "rest-client": "Rest Client"
};

/** Which list the sidebar shows: the workspace browser or the active tree. */
export type SidebarView = "workspaces" | "active";

/**
 * File-browser copy/cut clipboard. Lives here (not in FileBrowser state) so
 * copying in one project's Files tool and pasting in another's works — the
 * daemon has no notion of a clipboard, only a copy/move between two paths.
 */
export interface FsClipboardEntry {
  path: string;
  kind: "file" | "dir";
  mode: "copy" | "cut";
}

function upsertSession(sessions: SessionSummary[], next: SessionSummary): SessionSummary[] {
  const index = sessions.findIndex((s) => s.id === next.id);
  if (index === -1) {
    return [...sessions, next];
  }
  const copy = [...sessions];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export interface AppState {
  api: ApiClient | null;
  /** The local daemon remains available while a remote worker is selected. */
  localApi: ApiClient | null;
  connectionStatus: ConnectionStatus;
  /** >0 while auto-reconnecting (drives the "Reconnecting… attempt N" toast). */
  reconnectAttempt: number;

  // connections (local daemon + user-added remotes)
  connections: UiConnection[];
  activeConnectionId: string | null;

  // app config + settings modal
  appConfig: UiAppConfig;
  appConfigLoaded: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  /** Theme mode in effect once system/dynamic have been resolved. */
  resolvedMode: "light" | "dark";
  /** What the host window can do; defaults deny everything until reported. */
  windowCapabilities: WindowCapabilities;
  sidebarCollapsed: boolean;
  sidebarView: SidebarView;
  /** Mobile off-canvas sidebar drawer. */
  sidebarDrawerOpen: boolean;
  /** Client-only navigation state, kept separately for each worker. */
  clientUiState: ClientUiState;
  /** File-browser copy/cut clipboard; null when empty. */
  fsClipboard: FsClipboardEntry | null;

  // auth (web → password-protected HTTP daemon)
  authPrompt: { connectionId: string } | null;
  authSalt: string | null;
  sudoPrompt: { agentId: string } | null;

  // navigation
  currentWorkspace: string | null;
  currentProject: ProjectSummary | null;
  gitStatus: GitStatusResponse | null;
  gitStatusLoading: boolean;
  batteryStatus: BatteryStatusResponse | null;
  integrations: IntegrationStatus[];
  systemResources: SystemResourcesResponse | null;
  mediaStatus: MediaStatusResponse | null;
  networkingStatus: NetworkStatusResponse | null;
  processManagerStatus: ProcessManagerResponse | null;
  /** False after a session newly needs attention; cleared once the Agents panel is opened. */
  agentsBadgeSeen: boolean;

  // data
  registry: RegistryResponse;
  quotaById: Record<string, RegistryQuota>;
  workspaces: WorkspaceSummary[];
  workspacesLoading: boolean;
  projects: ProjectSummary[];
  projectsLoading: boolean;
  /** Scaffold catalog for the "Template" tab of project creation; fetched once, on demand. */
  projectTemplates: ProjectTemplateSummary[];
  projectTemplatesLoaded: boolean;

  /** All daemon sessions; a project's sessions are its tabs. */
  sessions: SessionSummary[];
  /** Client-local tool tabs (file browser, git tree) per project path. */
  toolTabsByProject: Record<string, ToolTab[]>;
  /** Client-local active tab id per project path (session or tool tab). */
  activeTabByProject: Record<string, string | null>;
  /** Every installed agent's past conversations, cached per project path.
   * Invalidated (not incrementally patched) when any agent session for that
   * project closes — the aggregation endpoint is one cheap combined fetch,
   * so refetching everything is simpler than tracking per-agent staleness. */
  agentConversationsByProject: Record<string, AgentConversationSummary[]>;

  setApi: (api: ApiClient) => void;
  connect: () => Promise<void>;
  /** Establish a connected session on an ApiClient (auth, load, subscribe, probe). */
  establish: (api: ApiClient) => Promise<void>;
  /** Called when the transport drops; runs the reconnect loop. */
  handleDisconnect: () => void;

  // connection management
  initConnections: (setup: ConnectionSetup) => Promise<void>;
  selectConnection: (id: string) => Promise<void>;
  addRemote: (input: { name: string; baseUrl: string; username?: string; password?: string }) => Promise<string>;
  removeRemote: (id: string) => Promise<void>;
  loadRemotes: () => Promise<void>;

  // app config + settings
  loadAppConfig: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  jumpToAttention: () => void;
  setResolvedMode: (mode: "light" | "dark") => void;
  setWindowCapabilities: (capabilities: WindowCapabilities) => void;
  toggleSidebar: () => void;
  setSidebarView: (view: SidebarView) => void;
  setSidebarDrawer: (open: boolean) => void;
  setSidebarScroll: (key: string, scrollTop: number) => void;
  setSidebarFilter: (key: string, value: string) => void;
  setPanelSize: (key: string, size: number) => void;
  setFsClipboard: (entry: FsClipboardEntry | null) => void;
  updateAppConfig: (patch: Partial<UiAppConfig>) => Promise<void>;
  setQuota: (quota: RegistryQuota) => void;

  // auth
  submitPassword: (username: string, password: string) => Promise<void>;
  signOut: () => void;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  openWorkspace: (name: string) => Promise<void>;
  closeWorkspace: () => void;
  restoreClientLocation: () => Promise<void>;
  recentProjects: RecentProjectSummary[];
  loadRecentProjects: () => Promise<void>;
  markProjectInteracted: (project?: ProjectSummary) => void;
  openRecentProject: (project: RecentProjectSummary) => Promise<void>;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  /** Creates the project, switches to it, then runs `command` (e.g. a git clone or
   * scaffold) in a fresh terminal tab so the user can watch it run and answer any prompts. */
  createProjectWithCommand: (name: string, command: string) => Promise<void>;
  loadProjectTemplates: () => Promise<void>;
  openProject: (project: ProjectSummary) => void;
  loadGitStatus: (projectPath?: string) => Promise<void>;
  initializeGit: () => Promise<void>;
  loadBatteryStatus: () => Promise<void>;
  loadIntegrations: () => Promise<void>;
  setIntegrations: (integrations: IntegrationStatus[]) => void;
  updateIntegration: (id: string, enabled: boolean) => Promise<void>;
  loadSystemResources: () => Promise<void>;
  loadMediaStatus: () => Promise<void>;
  controlMedia: (request: MediaControlRequest) => Promise<void>;
  loadNetworkingStatus: () => Promise<void>;
  killNetworkingProcess: (pid: number) => Promise<void>;
  loadProcessManagerStatus: () => Promise<void>;
  killProcess: (pid: number) => Promise<void>;

  loadSessions: () => Promise<void>;
  loadRegistry: () => Promise<void>;
  installAgent: (id: string) => Promise<void>;
  updateAgent: (id: string) => Promise<void>;
  openTab: (
    kind: RegistryKind,
    refId: string,
    title?: string,
    options?: { resumeConversationId?: string; initialCommand?: string }
  ) => Promise<void>;
  openTool: (kind: ToolKind) => void;
  closeTab: (id: string) => Promise<void>;
  activateTab: (id: string) => void;
  /** Cached per project; pass force to bypass the cache (e.g. a manual refresh). */
  loadAgentConversations: (projectPath: string, force?: boolean) => Promise<AgentConversationSummary[]>;
  acknowledgeSession: (id: string) => Promise<void>;
  dismissAgentsBadge: () => void;

  applyEvent: (event: EventMessage) => void;
  clearSudoPrompt: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  api: null,
  localApi: null,
  connectionStatus: "connecting",
  reconnectAttempt: 0,
  connections: [],
  activeConnectionId: null,
  appConfig: DEFAULT_APP_CONFIG,
  appConfigLoaded: false,
  settingsOpen: false,
  shortcutsOpen: false,
  resolvedMode: "dark",
  windowCapabilities: { blur: null, transparency: false },
  sidebarCollapsed: false,
  sidebarView: "workspaces",
  sidebarDrawerOpen: false,
  clientUiState: loadClientUiState(""),
  recentProjects: [],
  fsClipboard: null,
  authPrompt: null,
  authSalt: null,
  sudoPrompt: null,
  currentWorkspace: null,
  currentProject: null,
  gitStatus: null,
  gitStatusLoading: false,
  batteryStatus: null,
  integrations: [],
  systemResources: null,
  mediaStatus: null,
  networkingStatus: null,
  processManagerStatus: null,
  agentsBadgeSeen: true,
  registry: EMPTY_REGISTRY,
  quotaById: {},
  workspaces: [],
  workspacesLoading: false,
  projects: [],
  projectsLoading: false,
  projectTemplates: [],
  projectTemplatesLoaded: false,
  sessions: [],
  toolTabsByProject: {},
  activeTabByProject: {},
  agentConversationsByProject: {},

  setApi: (api) => set({ api }),

  connect: async () => {
    const initial = get().api;
    if (!initial) {
      return;
    }
    stopHealthProbe();
    reconnecting = false;
    set({ connectionStatus: "connecting", reconnectAttempt: 0 });

    // The embedded daemon is spawned asynchronously: poll /health first.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (get().api !== initial) {
        return;
      }
      try {
        await initial.health();
        break;
      } catch {
        await delay(500);
        if (attempt === 59) {
          set({ connectionStatus: "error" });
          return;
        }
        continue;
      }
    }

    await get().establish(initial);
  },

  establish: async (api) => {
    // Auth gate: derive/restore the bcrypt-hash bearer (web) or prompt.
    let active = api;
    const info = await active.authInfo().catch(() => null);
    set({ authSalt: info?.salt ?? null });
    if (info?.authRequired) {
      const hash = active.connection.password ?? loadStoredHash(active.connection.endpoint);
      if (!hash) {
        stopHealthProbe();
        set({ connectionStatus: "error", reconnectAttempt: 0, authPrompt: { connectionId: active.connection.id } });
        return;
      }
      if (active.connection.password !== hash) {
        active = apiWithPassword(active, hash);
        set({ api: active });
      }
    }

    set({ connectionStatus: "connected", reconnectAttempt: 0, authPrompt: null });
    await Promise.all([get().loadWorkspaces(), get().loadSessions(), get().loadRegistry(), get().loadRecentProjects(), get().loadBatteryStatus(), get().loadSystemResources(), get().loadMediaStatus(), get().loadNetworkingStatus(), get().loadProcessManagerStatus(), get().loadIntegrations()]);
    if (!get().currentWorkspace && get().clientUiState.lastWorkspace) {
      await get().restoreClientLocation();
    }

    // Live event sync. Git events are scoped to the project this client is
    // viewing, so inactive projects never create a polling workload.
    const projectPath = get().currentProject?.path;
    const subscribe = () => {
      closeEvents();
      const gen = eventsGen;
      eventsUnsubscribe = active.openEvents(
        projectPath,
        (event) => get().applyEvent(event),
        () => {
          if (gen === eventsGen) {
            get().handleDisconnect();
          }
        }
      );
    };
    if (projectPath) {
      void get().loadGitStatus(projectPath).finally(subscribe);
    } else {
      subscribe();
    }

    // Health probe: detect a dropped/restarted transport and auto-reconnect.
    stopHealthProbe();
    healthTimer = setInterval(() => {
      const current = get().api;
      if (current) {
        void current.health().catch(() => get().handleDisconnect());
      }
    }, 4000);
  },

  handleDisconnect: () => {
    stopHealthProbe();
    if (reconnecting || get().api === null) {
      return;
    }
    reconnecting = true;

    const loop = async () => {
      for (let attempt = 1; ; attempt += 1) {
        const current = get().api;
        if (!current) {
          break;
        }
        set({ connectionStatus: "connecting", reconnectAttempt: attempt });
        try {
          await current.health();
          // Daemon is back: rebuild the client so terminals + event streams
          // re-subscribe to the (intact) sessions, then re-establish.
          const fresh = apiWithPassword(current, current.connection.password ?? "");
          set({ api: fresh });
          await get().establish(fresh);
          break;
        } catch {
          await delay(Math.min(attempt * 1000, 8000));
        }
      }
      reconnecting = false;
    };
    void loop();
  },

  initConnections: async (nextSetup) => {
    setup = nextSetup;
    homeApi = new ApiClient(nextSetup.localConnection, buildTransporter(nextSetup.localConnection));
    const clientUiState = loadClientUiState(clientStateKey(nextSetup.localConnection.endpoint));
    set({
      connections: [nextSetup.localConnection],
      activeConnectionId: nextSetup.localConnection.id,
      appConfig: { ...DEFAULT_APP_CONFIG, useTitlebar: nextSetup.defaultUseTitlebar },
      appConfigLoaded: false,
      localApi: homeApi,
      api: homeApi,
      clientUiState,
      sidebarCollapsed: clientUiState.sidebarCollapsed,
      sidebarView: clientUiState.sidebarView
    });
    const appConfig = get().loadAppConfig();
    await get().connect();
    await Promise.all([appConfig, get().loadRemotes()]);
  },

  loadAppConfig: async () => {
    try {
      const adapter = setup?.appConfigAdapter;
      const config = adapter ? await adapter.load() : await homeApi?.getAppConfig();
      if (config) {
        set((state) => ({
          appConfig: {
            useTitlebar: config.useTitlebar ?? state.appConfig.useTitlebar,
            runInBackground: config.runInBackground ?? state.appConfig.runInBackground,
            startWorkerOnLogin: config.startWorkerOnLogin ?? state.appConfig.startWorkerOnLogin,
            sidebarOpacity: config.sidebarOpacity ?? state.appConfig.sidebarOpacity,
            glassSidebar: config.glassSidebar ?? state.appConfig.glassSidebar,
            titlebarOpacity: config.titlebarOpacity ?? state.appConfig.titlebarOpacity,
            glassTitlebar: config.glassTitlebar ?? state.appConfig.glassTitlebar,
            roundedWindow: config.roundedWindow ?? state.appConfig.roundedWindow,
            theme: config.theme ?? state.appConfig.theme,
            themeMode: config.themeMode ?? state.appConfig.themeMode,
            quotaResetFormat: config.quotaResetFormat ?? state.appConfig.quotaResetFormat,
            showQuotaMenu: config.showQuotaMenu ?? state.appConfig.showQuotaMenu,
            searchForUpdates: config.searchForUpdates ?? state.appConfig.searchForUpdates,
            updateChannel: config.updateChannel ?? state.appConfig.updateChannel,
            setupComplete: config.setupComplete ?? state.appConfig.setupComplete,
            localWorkerInstalled: config.localWorkerInstalled ?? state.appConfig.localWorkerInstalled
          }
        }));
      }
    } catch {
      /* keep defaults */
    } finally {
      set({ appConfigLoaded: true });
    }
  },

  loadRemotes: async () => {
    if (!homeApi || !setup) {
      return;
    }
    try {
      const adapter = setup?.appConfigAdapter;
      const remotes = adapter?.loadRemotes
        ? (await adapter.loadRemotes()).map(toUiConnection)
        : (await homeApi.listRemotes()).map(toUiConnection);
      set({ connections: [setup.localConnection, ...remotes] });
    } catch {
      /* keep local only */
    }
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  jumpToAttention: () => {
    const state = get();
    // Most recently flagged first — "what just needed me" beats whichever
    // tab happens to be oldest, which `createdAt` would've sorted by.
    const next = state.sessions
      .filter((session) => session.needsAttention)
      .sort((a, b) => (b.needsAttentionAt ?? b.createdAt).localeCompare(a.needsAttentionAt ?? a.createdAt))[0];
    if (!next) return;
    const { workspace, name } = resolveProjectPath(next.projectPath, state.workspaces);
    state.openProject({ name, workspace, path: next.projectPath });
    // Focusing it acknowledges it (see activateTab), so the next press lands
    // on whichever session most recently flagged among what's left.
    state.activateTab(next.id);
  },

  setResolvedMode: (mode) => set({ resolvedMode: mode }),

  setWindowCapabilities: (capabilities) => set({ windowCapabilities: capabilities }),

  toggleSidebar: () => set((state) => {
    const clientUiState = { ...state.clientUiState, sidebarCollapsed: !state.sidebarCollapsed };
    saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
    return { sidebarCollapsed: !state.sidebarCollapsed, clientUiState };
  }),

  setSidebarView: (view) => set((state) => {
    const clientUiState = { ...state.clientUiState, sidebarView: view };
    saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
    return { sidebarView: view, clientUiState };
  }),

  setSidebarDrawer: (open) => set({ sidebarDrawerOpen: open }),
  setSidebarScroll: (key, scrollTop) => set((state) => {
    const clientUiState = {
      ...state.clientUiState,
      sidebarScrollByKey: { ...state.clientUiState.sidebarScrollByKey, [key]: Math.max(0, scrollTop) }
    };
    saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
    return { clientUiState };
  }),
  setSidebarFilter: (key, value) => set((state) => {
    const clientUiState = { ...state.clientUiState, sidebarFilterByKey: { ...state.clientUiState.sidebarFilterByKey, [key]: value } };
    saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
    return { clientUiState };
  }),
  setPanelSize: (key, size) => set((state) => {
    const clientUiState = { ...state.clientUiState, panelSizes: { ...state.clientUiState.panelSizes, [key]: size } };
    saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
    return { clientUiState };
  }),
  setFsClipboard: (entry) => set({ fsClipboard: entry }),

  updateAppConfig: async (patch) => {
    const appConfig = { ...get().appConfig, ...patch };
    set({ appConfig });
    const adapter = setup?.appConfigAdapter;
    const full = {
      version: 1 as const,
      activeConnectionId: get().activeConnectionId ?? "local",
      ...appConfig
    };
    const result = adapter ? adapter.save(full) : homeApi?.updateAppConfig(appConfig);
    await result?.catch(() => undefined);
  },

  setQuota: (quota) => set((state) => {
    // A transient read failure shouldn't blank out data that loaded fine before.
    const cached = state.quotaById[quota.id];
    const next = !quota.supported && cached?.supported ? cached : quota;
    return { quotaById: { ...state.quotaById, [quota.id]: next } };
  }),

  submitPassword: async (username, password) => {
    const api = get().api;
    const salt = get().authSalt;
    if (!api || !salt) {
      return;
    }
    // Derive the same bcrypt hash the daemon stores; persist it (never the
    // plaintext) and use it as the bearer.
    const hash = deriveAuthHash(password, salt);
    storeHash(api.connection.endpoint, hash);
    const connection = { ...api.connection, username: username.trim(), password: hash };
    const nextApi = new ApiClient(connection, buildTransporter(connection));
    set({
      api: nextApi,
      connections: get().connections.map((item) => item.id === connection.id ? connection : item),
      authPrompt: null
    });
    await get().connect();
  },

  signOut: () => {
    const api = get().api;
    if (api) {
      stopHealthProbe();
      reconnecting = false;
      closeEvents();
      clearStoredHash(api.connection.endpoint);
      set({
        api: apiWithPassword(api, ""),
        connectionStatus: "error",
        reconnectAttempt: 0,
        authPrompt: { connectionId: api.connection.id }
      });
    }
  },

  selectConnection: async (id) => {
    const connection = get().connections.find((c) => c.id === id);
    if (!connection || id === get().activeConnectionId) {
      return;
    }
    stopHealthProbe();
    reconnecting = false;
    closeEvents();
    // Reset all daemon-scoped state: a different server has its own data.
    const clientUiState = loadClientUiState(clientStateKey(connection.endpoint));
    set({
      api: new ApiClient(connection, buildTransporter(connection)),
      activeConnectionId: id,
      currentWorkspace: null,
      currentProject: null,
      workspaces: [],
      projects: [],
      sessions: [],
      recentProjects: [],
      clientUiState,
      sidebarCollapsed: clientUiState.sidebarCollapsed,
      sidebarView: clientUiState.sidebarView
    });
    await get().connect();
  },

  addRemote: async (input) => {
    const endpoint = input.baseUrl.trim().replace(/\/$/, "");
    const rawPassword = input.password?.trim();
    let password: string | undefined;
    if (rawPassword) {
      // Same derivation as submitPassword: never store or transmit the
      // plaintext, only the bcrypt hash derived from the daemon's salt.
      const probe: UiConnection = { id: "", name: "", kind: "remote", endpoint, status: "disconnected", username: input.username?.trim() };
      const info = await new ApiClient(probe, buildTransporter(probe)).authInfo().catch(() => null);
      if (info?.salt) {
        password = deriveAuthHash(rawPassword, info.salt);
        storeHash(endpoint, password);
      }
    }
    const connection: UiConnection = {
      id: crypto.randomUUID(),
      name: input.name.trim() || input.baseUrl,
      kind: "remote",
      endpoint,
      status: "disconnected",
      username: input.username?.trim() || undefined,
      password
    };
    const connections = [...get().connections, connection];
    set({ connections });
    await persistRemotes(connections);
    return connection.id;
  },

  removeRemote: async (id) => {
    const connections = get().connections.filter((c) => c.id !== id);
    set({ connections });
    await persistRemotes(connections);
    if (get().activeConnectionId === id && setup) {
      await get().selectConnection(setup.localConnection.id);
    }
  },

  loadWorkspaces: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    set({ workspacesLoading: true });
    try {
      set({ workspaces: await workspaceService.list(api) });
    } catch (error) {
      // A wrong/stale token surfaces here — clear it and re-prompt.
      if (error instanceof ApiError && error.status === 401) {
        clearStoredHash(api.connection.endpoint);
        set({ connectionStatus: "error", authPrompt: { connectionId: api.connection.id } });
      } else {
        console.error("[orquester] failed to load workspaces", error);
      }
    } finally {
      set({ workspacesLoading: false });
    }
  },

  loadRecentProjects: async () => {
    const api = get().api;
    if (!api) return;
    try {
      set({ recentProjects: await api.listRecentProjects() });
    } catch {
      set({ recentProjects: [] });
    }
  },

  markProjectInteracted: (project) => {
    const api = get().api;
    const target = project ?? get().currentProject;
    if (!api || !target) return;
    void api.markProjectInteracted(target).then((recent) => {
      set((state) => ({ recentProjects: [recent, ...state.recentProjects.filter((item) => item.path !== recent.path)].slice(0, 30) }));
    }).catch(() => undefined);
  },

  openRecentProject: async (recent) => {
    await get().openWorkspace(recent.workspace);
    const project = get().projects.find((item) => item.path === recent.path);
    if (project) get().openProject(project);
  },

  createWorkspace: async (name) => {
    const api = get().api;
    if (!api) {
      return;
    }
    await workspaceService.create(api, name);
    await get().loadWorkspaces();
  },

  openWorkspace: async (name) => {
    set((state) => {
      const clientUiState = { ...state.clientUiState, lastWorkspace: name };
      saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
      return { currentWorkspace: name, projects: [], clientUiState };
    });
    await get().loadProjects();
  },

  closeWorkspace: () => set({ currentWorkspace: null, projects: [] }),

  restoreClientLocation: async () => {
    const cached = get().clientUiState;
    const workspace = get().workspaces.find((item) => item.name === cached.lastWorkspace);
    if (!workspace) return;
    await get().openWorkspace(workspace.name);
    const project = get().projects.find((item) => item.path === cached.lastProjectPath);
    if (project) get().openProject(project);
  },

  loadProjects: async () => {
    const api = get().api;
    const workspace = get().currentWorkspace;
    if (!api || !workspace) {
      set({ projects: [], projectsLoading: false });
      return;
    }
    set({ projectsLoading: true });
    try {
      set({ projects: await workspaceService.listProjects(api, workspace) });
    } catch (error) {
      console.error("[orquester] failed to load projects", error);
    } finally {
      set({ projectsLoading: false });
    }
  },

  createProject: async (name) => {
    const api = get().api;
    const workspace = get().currentWorkspace;
    if (!api || !workspace) {
      return;
    }
    await workspaceService.createProject(api, workspace, name);
    await get().loadProjects();
  },

  createProjectWithCommand: async (name, command) => {
    const api = get().api;
    const workspace = get().currentWorkspace;
    if (!api || !workspace) {
      return;
    }
    const project = await workspaceService.createProject(api, workspace, name);
    await get().loadProjects();
    get().openProject(project);
    // Every scaffold/clone command here is POSIX shell syntax, so prefer a
    // POSIX shell over whatever happens to be first in `registry.shells`
    // (unordered — it round-trips through a HashMap on the daemon side) to
    // avoid landing in nushell/fish/pwsh, which parse `--`/quoting differently.
    const enabled = get().registry.shells.filter((s) => s.enabled);
    const shellId = ["bash", "zsh", "sh"].map((id) => enabled.find((s) => s.id === id)?.id).find(Boolean) ?? enabled[0]?.id;
    if (shellId) {
      await get().openTab("shell", shellId, "Setup", { initialCommand: `${command}\r` });
    }
  },

  loadProjectTemplates: async () => {
    const api = get().api;
    if (!api || get().projectTemplatesLoaded) {
      return;
    }
    try {
      const { templates } = await api.listProjectTemplates();
      const normalized = templates.map((t) => ({
        ...t,
        category: t.category ?? "",
        requires: t.requires ?? [],
        variants: (t.variants ?? []).map((v) => ({ ...v, options: v.options ?? [] }))
      }));
      set({ projectTemplates: normalized, projectTemplatesLoaded: true });
    } catch (error) {
      console.error("[orquester] failed to load project templates", error);
    }
  },

  openProject: (project) => {
    // The active tree opens projects across workspaces: follow along so the
    // workspace browser and the project switcher stay on the same workspace.
    if (project.workspace && project.workspace !== get().currentWorkspace) {
      set({ currentWorkspace: project.workspace, projects: [] });
      void get().loadProjects();
    }
    set((state) => {
      const active = state.activeTabByProject[project.path];
      const fallback = firstTabId(state.sessions, state.toolTabsByProject, project.path);
      const clientUiState = { ...state.clientUiState, lastWorkspace: project.workspace || state.currentWorkspace, lastProjectPath: project.path };
      saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
      return {
        currentProject: project,
        clientUiState,
        // Opening a project reveals the main view — close the mobile drawer.
        sidebarDrawerOpen: false,
        activeTabByProject: {
          ...state.activeTabByProject,
          [project.path]: active ?? state.clientUiState.activeTabByProject[project.path] ?? fallback
        }
      };
    });
    const api = get().api;
    if (!api) {
      return;
    }
    void get().loadGitStatus(project.path).finally(() => {
      if (get().currentProject?.path !== project.path || get().api !== api) {
        return;
      }
      closeEvents();
      const gen = eventsGen;
      eventsUnsubscribe = api.openEvents(
        project.path,
        (event) => get().applyEvent(event),
        () => {
          if (gen === eventsGen) {
            get().handleDisconnect();
          }
        }
      );
    });
  },

  loadGitStatus: async (projectPath) => {
    const api = get().api;
    const path = projectPath ?? get().currentProject?.path;
    if (!api || !path) {
      set({ gitStatus: null, gitStatusLoading: false });
      return;
    }
    set({ gitStatusLoading: true });
    try {
      const status = await api.gitStatus(path);
      if (get().currentProject?.path === path) set({ gitStatus: status });
    } catch {
      set({ gitStatus: null });
    } finally {
      set({ gitStatusLoading: false });
    }
  },

  initializeGit: async () => {
    const api = get().api;
    const path = get().currentProject?.path;
    if (!api || !path) return;
    set({ gitStatusLoading: true });
    try {
      const status = await api.initializeGit({ path });
      if (get().currentProject?.path === path) set({ gitStatus: status });
    } finally {
      set({ gitStatusLoading: false });
    }
  },

  loadBatteryStatus: async () => {
    const api = get().api;
    if (!api) return;
    try {
      set({ batteryStatus: await api.batteryStatus() });
    } catch {
      set({ batteryStatus: null });
    }
  },

  loadIntegrations: async () => {
    const api = get().api;
    if (!api) return;
    try {
      set({ integrations: (await api.getIntegrations()).integrations });
    } catch {
      set({ integrations: [] });
    }
  },

  setIntegrations: (integrations) => set({ integrations }),

  updateIntegration: async (id, enabled) => {
    const api = get().api;
    if (!api) return;
    const next = Object.fromEntries(get().integrations.map((integration) => [integration.id, integration.id === id ? enabled : integration.enabled]));
    try {
      set({ integrations: (await api.updateIntegrations(next)).integrations });
    } catch {
      // Keep the current local state when the worker rejects the update.
    }
  },

  loadSystemResources: async () => {
    const api = get().api;
    if (!api) return;
    try {
      set({ systemResources: await api.systemResources() });
    } catch {
      set({ systemResources: null });
    }
  },

  loadMediaStatus: async () => {
    const api = get().api;
    if (!api) return;
    try {
      set({ mediaStatus: await api.mediaStatus() });
    } catch {
      set({ mediaStatus: null });
    }
  },

  controlMedia: async (request) => {
    const api = get().api;
    if (!api) return;
    const optimistic = applyOptimisticMediaControl(get().mediaStatus, request);
    if (optimistic !== get().mediaStatus) set({ mediaStatus: optimistic });
    try {
      const confirmed = await api.controlMedia(request);
      if (request.action !== "playPause" || confirmed.state === optimistic?.state) {
        set({ mediaStatus: confirmed });
      }
      void (async () => {
        await delay(350);
        if (get().api === api) await get().loadMediaStatus();
      })();
    } catch {
      void get().loadMediaStatus();
    }
  },

  loadNetworkingStatus: async () => {
    const api = get().api;
    if (!api) return;
    try { set({ networkingStatus: await api.networkingStatus() }); }
    catch { set({ networkingStatus: null }); }
  },

  killNetworkingProcess: async (pid) => {
    const api = get().api;
    if (!api) return;
    await api.killNetworkingProcess(pid);
    await get().loadNetworkingStatus();
  },

  loadProcessManagerStatus: async () => {
    const api = get().api;
    if (!api) return;
    try { set({ processManagerStatus: await api.processManagerStatus() }); }
    catch { set({ processManagerStatus: null }); }
  },

  killProcess: async (pid) => {
    const api = get().api;
    if (!api) return;
    await api.killProcess(pid);
    await get().loadProcessManagerStatus();
  },

  loadSessions: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    try {
      set({ sessions: await api.listSessions() });
    } catch (error) {
      console.error("[orquester] failed to load sessions", error);
    }
  },

  loadRegistry: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    try {
      set({ registry: await api.listRegistry() });
    } catch {
      /* keep current */
    }
  },

  installAgent: async (id) => {
    // Status (installing/installed/error) arrives via the "registry" event bus.
    await get().api?.installRegistryEntry(id).catch(() => undefined);
  },

  updateAgent: async (id) => {
    await get().api?.updateRegistryEntry(id).catch(() => undefined);
  },

  openTab: async (kind, refId, title, options) => {
    const api = get().api;
    if (!api) {
      return;
    }
    const project = get().currentProject;
    const session = await api.createSession({
      kind,
      refId,
      title,
      projectPath: project?.path ?? "",
      cwd: project?.path,
      resumeConversationId: options?.resumeConversationId
    });
    set((state) => {
      if (!project) return { sessions: upsertSession(state.sessions, session) };
      const activeTabByProject = { ...state.activeTabByProject, [project.path]: session.id };
      const clientUiState = { ...state.clientUiState, activeTabByProject: { ...state.clientUiState.activeTabByProject, [project.path]: session.id } };
      saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
      return { sessions: upsertSession(state.sessions, session), activeTabByProject, clientUiState };
    });
    get().markProjectInteracted(project ?? undefined);
    if (options?.initialCommand) {
      await api.sendSessionInput(session.id, options.initialCommand).catch(() => undefined);
    }
  },

  openTool: (kind) => {
    const project = get().currentProject;
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      const tab: ToolTab = { id: crypto.randomUUID(), projectPath: project.path, kind, title: TOOL_TITLES[kind] };
      const activeTabByProject = { ...state.activeTabByProject, [project.path]: tab.id };
      const clientUiState = { ...state.clientUiState, activeTabByProject: { ...state.clientUiState.activeTabByProject, [project.path]: tab.id } };
      saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
      return {
        toolTabsByProject: {
          ...state.toolTabsByProject,
          [project.path]: [...(state.toolTabsByProject[project.path] ?? []), tab]
        },
        activeTabByProject,
        clientUiState
      };
    });
    get().markProjectInteracted(project ?? undefined);
  },

  closeTab: async (id) => {
    const api = get().api;
    const session = get().sessions.find((s) => s.id === id);
    set((state) => (session ? removeSession(state, id) : removeToolTab(state, id)));
    if (session) {
      await api?.closeSession(id).catch(() => undefined);
      // The session it just spawned/updated is very likely a new or changed
      // conversation — drop the cache so the next overview fetch is fresh.
      if (session.kind === "agent" && session.projectPath) {
        set((state) => {
          const next = { ...state.agentConversationsByProject };
          delete next[session.projectPath];
          return { agentConversationsByProject: next };
        });
      }
    }
  },

  loadAgentConversations: async (projectPath, force) => {
    const cached = get().agentConversationsByProject[projectPath];
    if (cached && !force) {
      return cached;
    }
    const api = get().api;
    if (!api) {
      return cached ?? [];
    }
    try {
      const result = await api.listAgentConversations(projectPath);
      set((state) => ({ agentConversationsByProject: { ...state.agentConversationsByProject, [projectPath]: result.conversations } }));
      return result.conversations;
    } catch {
      return cached ?? [];
    }
  },

  activateTab: (id) => {
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      const activeTabByProject = { ...state.activeTabByProject, [project.path]: id };
      const clientUiState = { ...state.clientUiState, activeTabByProject: { ...state.clientUiState.activeTabByProject, [project.path]: id } };
      saveClientUiState(clientStateKey(state.api?.connection.endpoint ?? ""), clientUiState);
      return { activeTabByProject, clientUiState };
    });
    get().markProjectInteracted();
    // Focusing a session's tab is what "I've seen this" means, not just it
    // appearing in a list — clear needsAttention only here.
    const session = get().sessions.find((s) => s.id === id);
    if (session?.needsAttention) {
      void get().acknowledgeSession(id);
    }
  },

  acknowledgeSession: async (id) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id && s.needsAttention ? { ...s, needsAttention: false } : s))
    }));
    const api = get().api;
    if (!api) return;
    await api.acknowledgeSession(id).catch(() => undefined);
  },

  dismissAgentsBadge: () => set({ agentsBadgeSeen: true }),

  applyEvent: (event) => {
    if (event.channel === "system" && event.type === "battery.changed") {
      set({ batteryStatus: event.payload as BatteryStatusResponse });
      return;
    }
    if (event.channel === "system" && event.type === "resources.changed") {
      set({ systemResources: event.payload as SystemResourcesResponse });
      return;
    }
    if (event.channel === "system" && event.type === "media.changed") {
      set({ mediaStatus: event.payload as MediaStatusResponse });
      return;
    }
    if (event.channel === "system" && event.type === "networking.changed") {
      set({ networkingStatus: event.payload as NetworkStatusResponse });
      return;
    }
    if (event.channel === "system" && event.type === "processes.changed") {
      set({ processManagerStatus: event.payload as ProcessManagerResponse });
      return;
    }
    if (event.channel === "projects" && event.type === "project.git.changed") {
      const status = event.payload as GitStatusResponse;
      if (status.projectPath === get().currentProject?.path) set({ gitStatus: status });
      return;
    }
    if (event.channel === "registry" && event.type === "registry.install.sudoRequired") {
      const payload = event.payload as { id?: string };
      if (payload.id) set({ sudoPrompt: { agentId: payload.id } });
      return;
    }
    if (event.channel === "registry" && event.type === "registry.quota.changed") {
      get().setQuota(event.payload as RegistryQuota);
      return;
    }
    if (event.channel === "registry" && event.type === "registry.changed") {
      const entry = event.payload as RegistryEntry;
      set((state) => ({ registry: applyRegistryEntry(state.registry, entry) }));
      return;
    }
    if (event.channel !== "sessions") {
      return;
    }
    if (event.type === "session.created" || event.type === "session.exited" || event.type === "session.updated") {
      const summary = event.payload as SessionSummary;
      set((state) => {
        const previous = state.sessions.find((s) => s.id === summary.id);
        const newlyNeedsAttention = summary.needsAttention && !previous?.needsAttention;
        return {
          sessions: upsertSession(state.sessions, summary),
          agentsBadgeSeen: newlyNeedsAttention ? false : state.agentsBadgeSeen
        };
      });
    } else if (event.type === "session.closed") {
      const { id } = event.payload as { id: string };
      set((state) => removeSession(state, id));
    }
  },
  clearSudoPrompt: () => set({ sudoPrompt: null })
}));

/** First remaining tab id for a project (session preferred, then tool tab). */
function firstTabId(
  sessions: SessionSummary[],
  toolTabs: Record<string, ToolTab[]>,
  path: string
): string | null {
  return (
    sessions.find((s) => s.projectPath === path)?.id ?? toolTabs[path]?.[0]?.id ?? null
  );
}

function reassignActive(
  activeTabByProject: Record<string, string | null>,
  removedId: string,
  sessions: SessionSummary[],
  toolTabs: Record<string, ToolTab[]>
): Record<string, string | null> {
  const next = { ...activeTabByProject };
  for (const [path, activeId] of Object.entries(next)) {
    if (activeId === removedId) {
      next[path] = firstTabId(sessions, toolTabs, path);
    }
  }
  return next;
}

function removeSession(state: AppState, id: string): Partial<AppState> {
  const sessions = state.sessions.filter((s) => s.id !== id);
  return {
    sessions,
    activeTabByProject: reassignActive(state.activeTabByProject, id, sessions, state.toolTabsByProject)
  };
}

function removeToolTab(state: AppState, id: string): Partial<AppState> {
  const toolTabsByProject: Record<string, ToolTab[]> = {};
  for (const [path, tabs] of Object.entries(state.toolTabsByProject)) {
    toolTabsByProject[path] = tabs.filter((t) => t.id !== id);
  }
  return {
    toolTabsByProject,
    activeTabByProject: reassignActive(state.activeTabByProject, id, state.sessions, toolTabsByProject)
  };
}

/** Combined tabs (sessions + tool tabs) of the currently open project. */
export function useProjectTabs(): ProjectTab[] {
  const sessions = useAppStore((s) => s.sessions);
  const toolTabsByProject = useAppStore((s) => s.toolTabsByProject);
  const project = useAppStore((s) => s.currentProject);
  return useMemo(() => {
    if (!project) {
      return [];
    }
    const sessionTabs: ProjectTab[] = sessions
      .filter((s) => s.projectPath === project.path)
      .map((session) => ({ id: session.id, type: "session", session }));
    const toolTabs: ProjectTab[] = (toolTabsByProject[project.path] ?? []).map((tab) => ({
      id: tab.id,
      type: tab.kind,
      title: tab.title
    }));
    return [...sessionTabs, ...toolTabs];
  }, [sessions, toolTabsByProject, project]);
}

/** A project with at least one open tab. */
export interface ActiveProject {
  project: ProjectSummary;
  tabs: ProjectTab[];
}

/** A workspace with at least one active project, as the "Active" tree shows it. */
export interface ActiveWorkspace {
  name: string;
  projects: ActiveProject[];
}

/**
 * Resolve a project path back to its workspace and name. Paths come from the
 * daemon (`<workspacesDir>/<workspace>/<project>`), so the loaded workspace list
 * is the source of truth and the path segments are the fallback.
 */
function resolveProjectPath(
  path: string,
  workspaces: WorkspaceSummary[]
): { workspace: string; name: string } {
  const segments = path.split(/[/\\]/).filter(Boolean);
  const name = segments[segments.length - 1] ?? path;
  const owner = workspaces.find((w) => path.startsWith(`${w.path}/`) || path.startsWith(`${w.path}\\`));
  return { workspace: owner?.name ?? segments[segments.length - 2] ?? "", name };
}

/** Projects that currently hold tabs, grouped by workspace. */
export function useActiveWorkspaces(): ActiveWorkspace[] {
  const sessions = useAppStore((s) => s.sessions);
  const toolTabsByProject = useAppStore((s) => s.toolTabsByProject);
  const workspaces = useAppStore((s) => s.workspaces);

  return useMemo(() => {
    const tabsByPath = new Map<string, ProjectTab[]>();
    const push = (path: string, tab: ProjectTab) => {
      const list = tabsByPath.get(path);
      if (list) {
        list.push(tab);
      } else {
        tabsByPath.set(path, [tab]);
      }
    };

    for (const session of sessions) {
      if (session.projectPath) {
        push(session.projectPath, { id: session.id, type: "session", session });
      }
    }
    for (const [path, tabs] of Object.entries(toolTabsByProject)) {
      for (const tab of tabs) {
        push(path, { id: tab.id, type: tab.kind, title: tab.title });
      }
    }

    const groups = new Map<string, ActiveProject[]>();
    for (const [path, tabs] of tabsByPath) {
      const { workspace, name } = resolveProjectPath(path, workspaces);
      const projects = groups.get(workspace) ?? [];
      projects.push({ project: { name, workspace, path }, tabs });
      groups.set(workspace, projects);
    }

    const order = new Map(workspaces.map((workspace, index) => [workspace.name, index]));
    const rank = (name: string) => order.get(name) ?? workspaces.length;
    return [...groups.entries()]
      .map(([name, projects]) => ({
        name,
        projects: projects.sort((a, b) => a.project.name.localeCompare(b.project.name))
      }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  }, [sessions, toolTabsByProject, workspaces]);
}

/** An agent session paired with the project it belongs to (agent sessions can be in any workspace). */
export interface AgentSession {
  session: SessionSummary;
  project: ProjectSummary;
}

/** Every agent-kind session across every workspace — the Attention Center's data source. */
export function useAgentSessions(): AgentSession[] {
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  return useMemo(
    () =>
      sessions
        .filter((session) => session.kind === "agent")
        .map((session) => {
          const { workspace, name } = resolveProjectPath(session.projectPath, workspaces);
          return { session, project: { name, workspace, path: session.projectPath } };
        }),
    [sessions, workspaces]
  );
}

export function useActiveTabId(): string | null {
  return useAppStore((s) =>
    s.currentProject ? (s.activeTabByProject[s.currentProject.path] ?? null) : null
  );
}
