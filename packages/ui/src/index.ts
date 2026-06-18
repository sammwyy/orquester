import "./styles/globals.css";

// Root
export { OrquesterApp, type OrquesterAppProps } from "./OrquesterApp";

// Context
export {
  OrquesterProvider,
  useOrquester,
  useApi,
  type OrquesterContextValue,
  type WindowControls
} from "./context/orquester-context";

// Connection layer
export { ApiClient, ApiError, type ApiRequestOptions } from "./lib/api-client";
export {
  type Transporter,
  type TransportRequest,
  type TransportResponse,
  type TransportMethod,
  type EventHandler,
  type StreamHandle,
  type StreamHandlers,
  buildQueryString
} from "./lib/transporter";
export {
  FetchHttpClient,
  type HttpClient,
  type HttpClientRequest,
  type HttpClientResponse
} from "./lib/http-client";
export {
  createTransporter,
  HttpTransporter,
  type HttpTransporterOptions,
  type CreateTransporterOptions
} from "./lib/transporters";
export { toUiConnection, toRemoteConfig } from "./lib/connections";
export {
  createLocalStorageAppConfigAdapter,
  type AppConfigAdapter
} from "./lib/app-config";
export type { RemoteConnectionConfig, AppConfig, DaemonConfig } from "@orquester/config";

// State & data
export {
  useAppStore,
  useProjectTabs,
  useActiveTabId,
  type AppState,
  type FileTab,
  type ProjectTab
} from "./store/app";
export * from "./hooks";
export * from "./services";

// Components
export * from "./components/ui";
export * from "./components/layout";
export * from "./components/sidebar";
export * from "./components/topbar";
export * from "./components/main";
export * from "./components/terminal";
export * from "./components/servers";
export * from "./components/files";
export * from "./components/settings";
export * from "./components/auth";
export * from "./components/status";

// Icons
export { getRegistryIcon, RegistryIcon } from "./icons";

// Types
export type {
  Runtime,
  UiConnection,
  ConnectionKind,
  ConnectionStatus,
  RegistryEntry,
  RegistryKind,
  RegistryResponse,
  SessionStatus,
  SessionSummary,
  AgentSummary,
  OpenTargetSummary,
  ProjectSummary,
  WorkspaceSummary
} from "./types";
