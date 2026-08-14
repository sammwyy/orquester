import type { SidebarView } from "../store/app";

export interface ClientUiState {
  lastWorkspace: string | null;
  lastProjectPath: string | null;
  sidebarCollapsed: boolean;
  sidebarView: SidebarView;
  sidebarScrollByKey: Record<string, number>;
  sidebarFilterByKey: Record<string, string>;
  activeTabByProject: Record<string, string | null>;
  panelSizes: Record<string, number>;
}

const STORAGE_KEY = "orquester.client-ui.v1";

const DEFAULT_CLIENT_STATE: ClientUiState = {
  lastWorkspace: null,
  lastProjectPath: null,
  sidebarCollapsed: false,
  sidebarView: "workspaces",
  sidebarScrollByKey: {},
  sidebarFilterByKey: {},
  activeTabByProject: {},
  panelSizes: {}
};

function readAll(): Record<string, ClientUiState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ClientUiState>>;
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, normalize(value)])
    );
  } catch {
    return {};
  }
}

function normalize(value: Partial<ClientUiState> | undefined): ClientUiState {
  return {
    lastWorkspace: typeof value?.lastWorkspace === "string" ? value.lastWorkspace : null,
    lastProjectPath: typeof value?.lastProjectPath === "string" ? value.lastProjectPath : null,
    sidebarCollapsed: value?.sidebarCollapsed === true,
    sidebarView: value?.sidebarView === "active" ? "active" : "workspaces",
    sidebarScrollByKey: Object.fromEntries(
      Object.entries(value?.sidebarScrollByKey ?? {}).filter(([, scroll]) => typeof scroll === "number" && scroll >= 0)
    ),
    sidebarFilterByKey: Object.fromEntries(Object.entries(value?.sidebarFilterByKey ?? {}).filter(([, filter]) => typeof filter === "string")),
    activeTabByProject: Object.fromEntries(Object.entries(value?.activeTabByProject ?? {}).filter(([, tab]) => tab === null || typeof tab === "string")),
    panelSizes: Object.fromEntries(Object.entries(value?.panelSizes ?? {}).filter(([, size]) => typeof size === "number" && size > 0))
  };
}

export function loadClientUiState(workerKey: string): ClientUiState {
  return readAll()[workerKey] ?? { ...DEFAULT_CLIENT_STATE, sidebarScrollByKey: {}, sidebarFilterByKey: {}, activeTabByProject: {}, panelSizes: {} };
}

export function saveClientUiState(workerKey: string, state: ClientUiState): void {
  try {
    const all = readAll();
    all[workerKey] = normalize(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* localStorage can be unavailable or full; navigation must still work. */
  }
}

export function clientStateKey(endpoint: string): string {
  return endpoint.trim().replace(/\/$/, "");
}
