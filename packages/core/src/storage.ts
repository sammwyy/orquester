import type { AppConfig, RemoteConnectionConfig } from "@orquester/config";

/** Per-client persistence. Each runtime supplies its own secure implementation. */
export interface AppConfigAdapter {
  load(): Promise<Partial<AppConfig>>;
  save(config: AppConfig): Promise<void>;
  loadRemotes?(): Promise<RemoteConnectionConfig[]>;
  saveRemotes?(remotes: RemoteConnectionConfig[]): Promise<void>;
}

export interface WorkerCredential {
  username: string;
  password: string;
}

/** Secure storage for remote-worker credentials, implemented by each platform. */
export interface CredentialVault {
  load(endpoint: string): Promise<WorkerCredential | undefined>;
  save(endpoint: string, credential: WorkerCredential): Promise<boolean>;
  forget(endpoint: string): Promise<void>;
}
