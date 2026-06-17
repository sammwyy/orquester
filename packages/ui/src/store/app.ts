import { create } from "zustand";
import type { Tab, TabKind } from "../types";

let tabCounter = 0;
const nextTabId = () => `tab-${++tabCounter}`;

const TAB_TITLES: Record<TabKind, string> = {
  terminal: "Terminal",
  files: "File Explorer",
  agent: "Agent"
};

export interface AppState {
  /** Sidebar navigation: which workspace folder is open (null = workspace list). */
  currentWorkspace: string | null;
  /** Selected project (drives the main view); null = nothing open. */
  currentProject: string | null;

  tabs: Tab[];
  activeTabId: string | null;

  // sidebar navigation
  openWorkspace: (name: string) => void;
  closeWorkspace: () => void;
  openProject: (name: string) => void;
  closeProject: () => void;

  // tabs
  addTab: (kind: TabKind, options?: { title?: string; agentId?: string }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentWorkspace: null,
  currentProject: null,
  tabs: [],
  activeTabId: null,

  openWorkspace: (name) => set({ currentWorkspace: name }),
  closeWorkspace: () => set({ currentWorkspace: null }),

  // Selecting a project resets the tab strip (skeleton: tabs are per-project).
  openProject: (name) => set({ currentProject: name, tabs: [], activeTabId: null }),
  closeProject: () => set({ currentProject: null, tabs: [], activeTabId: null }),

  addTab: (kind, options) =>
    set((state) => {
      const tab: Tab = {
        id: nextTabId(),
        kind,
        title: options?.title ?? TAB_TITLES[kind],
        agentId: options?.agentId
      };
      return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),

  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      const activeTabId =
        state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
      return { tabs, activeTabId };
    }),

  activateTab: (id) => set({ activeTabId: id })
}));
