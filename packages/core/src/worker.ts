export interface WorkerStatus {
  installed: boolean;
  running: boolean;
  source: "repository" | "release";
}

export interface WorkerServiceStatus {
  installed: boolean;
  running: boolean;
}

export interface LocalWorkerSetup {
  startWorkerOnLogin: boolean;
  remoteAccess: boolean;
  port: number;
  username?: string;
  password?: string;
  serveWeb: boolean;
  workspacesDir?: string;
}

/** Host integration for a locally installed worker. */
export interface WorkerManager {
  status(): Promise<WorkerStatus>;
  install(): Promise<void>;
  configure(input: LocalWorkerSetup): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  serviceStatus(): Promise<WorkerServiceStatus>;
  setServiceEnabled(enabled: boolean): Promise<void>;
  chooseWorkspacesDirectory(): Promise<string | undefined>;
}
