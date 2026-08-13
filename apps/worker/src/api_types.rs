//! Hand-ported mirror of packages/api/src/index.ts. Keep field-for-field in
//! sync with that file; there is no codegen bridging the two.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub daemon_id: String,
    pub version: String,
    pub mode: TransportMode,
    pub transports: Vec<Transport>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransportMode {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Unix,
    Http,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    pub terminals: bool,
    pub sessions: bool,
    pub agents: bool,
    pub docker: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoResponse {
    pub name: String,
    pub data_dir: String,
    pub workspaces_dir: String,
    pub capabilities: ServerCapabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub name: String,
    pub path: String,
    pub project_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub name: String,
    pub workspace: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitLine {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResponse {
    pub project_path: String,
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    pub additions: i64,
    pub deletions: i64,
    pub commits: Vec<GitCommitLine>,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitInitRequest {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub commit_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesResponse {
    pub branches: Vec<GitBranchSummary>,
    pub current_branch: Option<String>,
    pub detached_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub subject: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResponse {
    pub commits: Vec<GitCommitSummary>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
    pub path: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub subject: String,
    pub body: String,
    pub files: Vec<GitCommitFile>,
    pub diff: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitCheckoutRequest {
    pub path: Option<String>,
    pub r#ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitPathRequest {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashSummary {
    pub index: usize,
    pub r#ref: String,
    pub hash: String,
    pub branch: String,
    pub message: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashListResponse {
    pub stashes: Vec<GitStashSummary>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitStashActionRequest {
    pub path: Option<String>,
    pub r#ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitStashCreateRequest {
    pub path: Option<String>,
    pub message: Option<String>,
    pub include_untracked: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkingDiffResponse {
    pub diff: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitFilesRequest {
    pub path: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GitCommitRequest {
    pub path: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryStatusResponse {
    pub has_battery: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percentage: Option<u32>,
    pub charging: bool,
    pub plugged_in: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsResponse {
    pub integrations: Vec<IntegrationStatus>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateIntegrationsRequest {
    pub integrations: std::collections::HashMap<String, bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUsage {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuUsage {
    pub percentage: f64,
    pub cores: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub percentage: f64,
    pub mount: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemResourcesResponse {
    pub cpu: CpuUsage,
    pub memory: ResourceUsage,
    pub disk: DiskUsage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaPlaybackState {
    Playing,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStatusResponse {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    pub state: MediaPlaybackState,
    pub volume: f64,
    pub volume_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_key: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaAction {
    Previous,
    PlayPause,
    Next,
    Volume,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaControlRequest {
    pub action: Option<MediaAction>,
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateWorkspaceRequest {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateProjectRequest {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FsEntryKind {
    Dir,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub kind: FsEntryKind,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListResponse {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FsEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResponse {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FsCreateRequest {
    pub path: Option<String>,
    pub kind: Option<FsEntryKind>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FsWriteRequest {
    pub path: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FsDeleteRequest {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FsMoveRequest {
    pub path: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FsCopyRequest {
    pub path: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsSearchResponse {
    pub query: String,
    pub matches: Vec<FsSearchMatch>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestDef {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<HttpHeader>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// `{{name}}` references this request makes that no `@name = value` in
    /// the file defines — resolved from this project's worker-side variable
    /// store at execute time, never given a value here.
    pub store_variables: Vec<String>,
    /// `{{env_NAME}}` references — resolved from the project's own `.env`.
    pub env_variables: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFileParsed {
    pub path: String,
    pub name: String,
    pub variables: std::collections::HashMap<String, String>,
    pub requests: Vec<HttpRequestDef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFileListResponse {
    pub files: Vec<HttpFileParsed>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpExecuteRequest {
    pub method: Option<String>,
    pub url: Option<String>,
    pub headers: Option<Vec<HttpHeader>>,
    pub body: Option<String>,
    /// Project whose variable store / `.env` resolve any `{{name}}` left unresolved.
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpExecuteResponse {
    pub ok: bool,
    /// 0 when the request never got a response (invalid method/URL, network error).
    pub status: u16,
    /// Canonical reason phrase on success, the error message otherwise.
    pub status_text: String,
    pub headers: Vec<HttpHeader>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: u64,
    pub truncated: bool,
}

/// Variable *names* only — values never leave the worker (see integrations::rest_client::variables).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpVariableListResponse {
    pub names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpVariableSetRequest {
    pub path: Option<String>,
    pub name: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HttpVariableDeleteRequest {
    pub path: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfoResponse {
    pub auth_required: bool,
    pub salt: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RegistryKind {
    Shell,
    Agent,
    Ide,
    FileExplorer,
    Browser,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RegistryInstallState {
    Idle,
    Installing,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub kind: RegistryKind,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub can_install: bool,
    pub can_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website_url: Option<String>,
    pub missing_dependencies: Vec<String>,
    pub install_state: RegistryInstallState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryResponse {
    pub shells: Vec<RegistryEntry>,
    pub agents: Vec<RegistryEntry>,
    pub ides: Vec<RegistryEntry>,
    pub file_explorers: Vec<RegistryEntry>,
    pub browsers: Vec<RegistryEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryActionResult {
    pub ok: bool,
    pub exit_code: i32,
    pub output: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuotaPeriod {
    Hourly,
    Daily,
    Weekly,
    Monthly,
    Rolling,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuotaUnit {
    Requests,
    Tokens,
    Credits,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RegistryAuthStatus {
    Authenticated,
    Unauthenticated,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAuthInfo {
    pub status: RegistryAuthStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub id: String,
    pub label: String,
    pub period: QuotaPeriod,
    pub unit: QuotaUnit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent_used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryQuota {
    pub id: String,
    pub provider: String,
    pub auth: RegistryAuthInfo,
    pub supported: bool,
    pub fetched_at: String,
    pub windows: Vec<QuotaWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenRequest {
    pub target_id: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Running,
    Exited,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub kind: RegistryKind,
    pub ref_id: String,
    pub title: String,
    pub project_path: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub status: SessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// Produced PTY output within the last couple of seconds.
    pub active: bool,
    /// Rang the terminal bell, or exited, since this was last acknowledged.
    pub needs_attention: bool,
    /// When `needs_attention` last flipped true; lets clients jump to the
    /// most recently-flagged session rather than the oldest tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_attention_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPort {
    pub protocol: String,
    pub address: String,
    pub port: u16,
    pub pid: u32,
    pub process: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatusResponse {
    pub ports: Vec<NetworkPort>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KillNetworkProcessRequest {
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessNode {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub cpu_percentage: f64,
    pub memory_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub is_session_root: bool,
    pub children: Vec<ProcessNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessManagerResponse {
    pub roots: Vec<ProcessNode>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KillProcessRequest {
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateSessionRequest {
    pub kind: Option<RegistryKind>,
    pub ref_id: Option<String>,
    pub project_path: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionInputRequest {
    pub data: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionResizeRequest {
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SessionStreamMessage {
    Buffer { data: String },
    Output { data: String },
    Exit { exit_code: i32 },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SessionInputMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMessage<T: Serialize> {
    pub id: String,
    pub channel: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub created_at: String,
    pub payload: T,
}

/// API error body shared by every failing route.
#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }

    /// The JSON error Response every route handler returns on failure —
    /// shared so route modules don't each redefine the same wrapper.
    pub fn response(status: axum::http::StatusCode, code: &str, message: impl Into<String>) -> axum::response::Response {
        use axum::response::IntoResponse;
        (status, axum::Json(Self::new(code, message))).into_response()
    }
}
