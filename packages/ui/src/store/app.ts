import { useMemo } from "react";
import { create } from "zustand";
import { ApiClient } from "../lib/api-client";
import { createTransporter } from "../lib/transporters";
import {
  toRemoteConfig,
  toUiConnection,
  type ConnectionsAdapter
} from "../lib/connections";
import type { HttpClient } from "../lib/http-client";
import type { Transporter } from "../lib/transporter";
import { workspaceService } from "../services";
import type {
  ConnectionStatus,
  EventMessage,
  ProjectSummary,
  RegistryKind,
  SessionSummary,
  UiConnection,
  WorkspaceSummary
} from "../types";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Module-level handle so we can drop the events subscription on reconnect. */
let eventsUnsubscribe: (() => void) | null = null;

/** Host-provided connection wiring, set once via initConnections(). */
interface ConnectionSetup {
  localConnection: UiConnection;
  /** Injected transport for the local connection (desktop unix socket). */
  localTransporter?: Transporter;
  /** Custom HTTP client for remote transporters (rarely needed). */
  httpClient?: HttpClient;
  adapter?: ConnectionsAdapter;
}

let setup: ConnectionSetup | null = null;

/** Build the transporter for a connection: local uses the injected one. */
function buildTransporter(connection: UiConnection): Transporter {
  if (setup && connection.id === setup.localConnection.id && setup.localTransporter) {
    return setup.localTransporter;
  }
  return createTransporter(connection, { httpClient: setup?.httpClient });
}

/** A client-local, non-PTY tab (e.g. the file browser). */
export interface FileTab {
  id: string;
  projectPath: string;
  title: string;
}

/** A tab in the current project: a daemon session or a local tool tab. */
export type ProjectTab =
  | { id: string; type: "session"; session: SessionSummary }
  | { id: string; type: "files"; title: string };

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
  connectionStatus: ConnectionStatus;

  // connections (local daemon + user-added remotes)
  connections: UiConnection[];
  activeConnectionId: string | null;

  // navigation
  currentWorkspace: string | null;
  currentProject: ProjectSummary | null;

  // data
  workspaces: WorkspaceSummary[];
  workspacesLoading: boolean;
  projects: ProjectSummary[];
  projectsLoading: boolean;

  /** All daemon sessions; a project's sessions are its tabs. */
  sessions: SessionSummary[];
  /** Client-local tool tabs (file browser) per project path. */
  fileTabsByProject: Record<string, FileTab[]>;
  /** Client-local active tab id per project path (session or file tab). */
  activeTabByProject: Record<string, string | null>;

  setApi: (api: ApiClient) => void;
  connect: () => Promise<void>;

  // connection management
  initConnections: (setup: ConnectionSetup) => Promise<void>;
  selectConnection: (id: string) => Promise<void>;
  addRemote: (input: { name: string; baseUrl: string; password?: string }) => Promise<string>;
  removeRemote: (id: string) => Promise<void>;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  openWorkspace: (name: string) => Promise<void>;
  closeWorkspace: () => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  openProject: (project: ProjectSummary) => void;

  loadSessions: () => Promise<void>;
  openTab: (kind: RegistryKind, refId: string, title?: string) => Promise<void>;
  openFileBrowser: () => void;
  closeTab: (id: string) => Promise<void>;
  activateTab: (id: string) => void;

  applyEvent: (event: EventMessage) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  api: null,
  connectionStatus: "connecting",
  connections: [],
  activeConnectionId: null,
  currentWorkspace: null,
  currentProject: null,
  workspaces: [],
  workspacesLoading: false,
  projects: [],
  projectsLoading: false,
  sessions: [],
  fileTabsByProject: {},
  activeTabByProject: {},

  setApi: (api) => set({ api }),

  connect: async () => {
    const api = get().api;
    if (!api) {
      return;
    }
    set({ connectionStatus: "connecting" });

    // The embedded daemon is spawned asynchronously: poll /health first.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (get().api !== api) {
        return;
      }
      try {
        await api.health();
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

    set({ connectionStatus: "connected" });
    await Promise.all([get().loadWorkspaces(), get().loadSessions()]);

    // Subscribe to the event bus for cross-client session sync.
    eventsUnsubscribe?.();
    eventsUnsubscribe = api.openEvents((event) => get().applyEvent(event));
  },

  initConnections: async (nextSetup) => {
    setup = nextSetup;
    const remotes = (await nextSetup.adapter?.load().catch(() => []))?.map(toUiConnection) ?? [];
    const connections = [nextSetup.localConnection, ...remotes];
    set({
      connections,
      activeConnectionId: nextSetup.localConnection.id,
      api: new ApiClient(nextSetup.localConnection, buildTransporter(nextSetup.localConnection))
    });
    await get().connect();
  },

  selectConnection: async (id) => {
    const connection = get().connections.find((c) => c.id === id);
    if (!connection || id === get().activeConnectionId) {
      return;
    }
    eventsUnsubscribe?.();
    eventsUnsubscribe = null;
    // Reset all daemon-scoped state: a different server has its own data.
    set({
      api: new ApiClient(connection, buildTransporter(connection)),
      activeConnectionId: id,
      currentWorkspace: null,
      currentProject: null,
      workspaces: [],
      projects: [],
      sessions: []
    });
    await get().connect();
  },

  addRemote: async (input) => {
    const connection: UiConnection = {
      id: crypto.randomUUID(),
      name: input.name.trim() || input.baseUrl,
      kind: "remote",
      endpoint: input.baseUrl.trim().replace(/\/$/, ""),
      status: "disconnected",
      password: input.password?.trim() || undefined
    };
    const connections = [...get().connections, connection];
    set({ connections });
    await setup?.adapter
      ?.save(connections.filter((c) => c.kind === "remote").map(toRemoteConfig))
      .catch(() => undefined);
    return connection.id;
  },

  removeRemote: async (id) => {
    const connections = get().connections.filter((c) => c.id !== id);
    set({ connections });
    await setup?.adapter
      ?.save(connections.filter((c) => c.kind === "remote").map(toRemoteConfig))
      .catch(() => undefined);
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
      console.error("[orquester] failed to load workspaces", error);
    } finally {
      set({ workspacesLoading: false });
    }
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
    set({ currentWorkspace: name, projects: [] });
    await get().loadProjects();
  },

  closeWorkspace: () => set({ currentWorkspace: null, projects: [] }),

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

  openProject: (project) =>
    set((state) => {
      const active = state.activeTabByProject[project.path];
      const fallback = firstTabId(state.sessions, state.fileTabsByProject, project.path);
      return {
        currentProject: project,
        activeTabByProject: {
          ...state.activeTabByProject,
          [project.path]: active ?? fallback
        }
      };
    }),

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

  openTab: async (kind, refId, title) => {
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
      cwd: project?.path
    });
    set((state) => ({
      sessions: upsertSession(state.sessions, session),
      activeTabByProject: project
        ? { ...state.activeTabByProject, [project.path]: session.id }
        : state.activeTabByProject
    }));
  },

  openFileBrowser: () =>
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      const tab: FileTab = { id: crypto.randomUUID(), projectPath: project.path, title: "Files" };
      return {
        fileTabsByProject: {
          ...state.fileTabsByProject,
          [project.path]: [...(state.fileTabsByProject[project.path] ?? []), tab]
        },
        activeTabByProject: { ...state.activeTabByProject, [project.path]: tab.id }
      };
    }),

  closeTab: async (id) => {
    const api = get().api;
    const isSession = get().sessions.some((s) => s.id === id);
    set((state) => (isSession ? removeSession(state, id) : removeFileTab(state, id)));
    if (isSession) {
      await api?.closeSession(id).catch(() => undefined);
    }
  },

  activateTab: (id) =>
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      return { activeTabByProject: { ...state.activeTabByProject, [project.path]: id } };
    }),

  applyEvent: (event) => {
    if (event.channel !== "sessions") {
      return;
    }
    if (event.type === "session.created" || event.type === "session.exited") {
      const summary = event.payload as SessionSummary;
      set((state) => ({ sessions: upsertSession(state.sessions, summary) }));
    } else if (event.type === "session.closed") {
      const { id } = event.payload as { id: string };
      set((state) => removeSession(state, id));
    }
  }
}));

/** First remaining tab id for a project (session preferred, then file tab). */
function firstTabId(
  sessions: SessionSummary[],
  fileTabs: Record<string, FileTab[]>,
  path: string
): string | null {
  return (
    sessions.find((s) => s.projectPath === path)?.id ?? fileTabs[path]?.[0]?.id ?? null
  );
}

function reassignActive(
  activeTabByProject: Record<string, string | null>,
  removedId: string,
  sessions: SessionSummary[],
  fileTabs: Record<string, FileTab[]>
): Record<string, string | null> {
  const next = { ...activeTabByProject };
  for (const [path, activeId] of Object.entries(next)) {
    if (activeId === removedId) {
      next[path] = firstTabId(sessions, fileTabs, path);
    }
  }
  return next;
}

function removeSession(state: AppState, id: string): Partial<AppState> {
  const sessions = state.sessions.filter((s) => s.id !== id);
  return {
    sessions,
    activeTabByProject: reassignActive(state.activeTabByProject, id, sessions, state.fileTabsByProject)
  };
}

function removeFileTab(state: AppState, id: string): Partial<AppState> {
  const fileTabsByProject: Record<string, FileTab[]> = {};
  for (const [path, tabs] of Object.entries(state.fileTabsByProject)) {
    fileTabsByProject[path] = tabs.filter((t) => t.id !== id);
  }
  return {
    fileTabsByProject,
    activeTabByProject: reassignActive(state.activeTabByProject, id, state.sessions, fileTabsByProject)
  };
}

/** Combined tabs (sessions + file tabs) of the currently open project. */
export function useProjectTabs(): ProjectTab[] {
  const sessions = useAppStore((s) => s.sessions);
  const fileTabsByProject = useAppStore((s) => s.fileTabsByProject);
  const project = useAppStore((s) => s.currentProject);
  return useMemo(() => {
    if (!project) {
      return [];
    }
    const sessionTabs: ProjectTab[] = sessions
      .filter((s) => s.projectPath === project.path)
      .map((session) => ({ id: session.id, type: "session", session }));
    const fileTabs: ProjectTab[] = (fileTabsByProject[project.path] ?? []).map((tab) => ({
      id: tab.id,
      type: "files",
      title: tab.title
    }));
    return [...sessionTabs, ...fileTabs];
  }, [sessions, fileTabsByProject, project]);
}

export function useActiveTabId(): string | null {
  return useAppStore((s) =>
    s.currentProject ? (s.activeTabByProject[s.currentProject.path] ?? null) : null
  );
}
