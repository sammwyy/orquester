import { create } from "zustand";
import type { ApiClient } from "../lib/api-client";
import { workspaceService } from "../services";
import type { ProjectSummary, Tab, TabKind, WorkspaceSummary } from "../types";

let tabCounter = 0;
const nextTabId = () => `tab-${++tabCounter}`;

const TAB_TITLES: Record<TabKind, string> = {
  terminal: "Terminal",
  files: "File Explorer",
  agent: "Agent"
};

/** Stable empty array so tab selectors don't trigger re-renders. */
const EMPTY_TABS: Tab[] = [];

export interface AppState {
  /** Server manager bound from <OrquesterApp> at startup. */
  api: ApiClient | null;

  // --- navigation ---
  /** Workspace folder open in the sidebar (null = workspace list). */
  currentWorkspace: string | null;
  /** Project driving the main view (independent of sidebar navigation). */
  currentProject: ProjectSummary | null;

  // --- data ---
  workspaces: WorkspaceSummary[];
  workspacesLoading: boolean;
  projects: ProjectSummary[];
  projectsLoading: boolean;

  // --- tabs (kept per project so switching projects doesn't destroy them) ---
  tabsByProject: Record<string, Tab[]>;
  activeTabByProject: Record<string, string | null>;

  setApi: (api: ApiClient) => void;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  openWorkspace: (name: string) => Promise<void>;
  closeWorkspace: () => void;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  openProject: (project: ProjectSummary) => void;

  addTab: (kind: TabKind, options?: { title?: string; agentId?: string }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  api: null,
  currentWorkspace: null,
  currentProject: null,
  workspaces: [],
  workspacesLoading: false,
  projects: [],
  projectsLoading: false,
  tabsByProject: {},
  activeTabByProject: {},

  setApi: (api) => set({ api }),

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
    set((state) => ({
      currentProject: project,
      tabsByProject: project.path in state.tabsByProject
        ? state.tabsByProject
        : { ...state.tabsByProject, [project.path]: [] },
      activeTabByProject:
        project.path in state.activeTabByProject
          ? state.activeTabByProject
          : { ...state.activeTabByProject, [project.path]: null }
    })),

  addTab: (kind, options) =>
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      const key = project.path;
      const tab: Tab = {
        id: nextTabId(),
        kind,
        title: options?.title ?? TAB_TITLES[kind],
        agentId: options?.agentId
      };
      return {
        tabsByProject: { ...state.tabsByProject, [key]: [...(state.tabsByProject[key] ?? []), tab] },
        activeTabByProject: { ...state.activeTabByProject, [key]: tab.id }
      };
    }),

  closeTab: (id) =>
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      const key = project.path;
      const tabs = (state.tabsByProject[key] ?? []).filter((tab) => tab.id !== id);
      const wasActive = state.activeTabByProject[key] === id;
      return {
        tabsByProject: { ...state.tabsByProject, [key]: tabs },
        activeTabByProject: {
          ...state.activeTabByProject,
          [key]: wasActive ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabByProject[key]
        }
      };
    }),

  activateTab: (id) =>
    set((state) => {
      const project = state.currentProject;
      if (!project) {
        return state;
      }
      return { activeTabByProject: { ...state.activeTabByProject, [project.path]: id } };
    })
}));

/** Tabs of the currently open project (stable ref when unchanged). */
export function useCurrentTabs(): Tab[] {
  return useAppStore((s) =>
    s.currentProject ? (s.tabsByProject[s.currentProject.path] ?? EMPTY_TABS) : EMPTY_TABS
  );
}

export function useActiveTabId(): string | null {
  return useAppStore((s) =>
    s.currentProject ? (s.activeTabByProject[s.currentProject.path] ?? null) : null
  );
}
