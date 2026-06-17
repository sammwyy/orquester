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

// State & data
export { useAppStore, type AppState } from "./store/app";
export * from "./hooks";
export * from "./services";

// Components
export * from "./components/ui";
export * from "./components/layout";
export * from "./components/sidebar";
export * from "./components/topbar";
export * from "./components/main";

// Types
export type {
  Runtime,
  UiConnection,
  ConnectionKind,
  ConnectionStatus,
  Tab,
  TabKind,
  AgentSummary,
  OpenTargetSummary,
  ProjectSummary,
  WorkspaceSummary
} from "./types";
