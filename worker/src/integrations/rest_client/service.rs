//! Discovers `.http`/`.rest` files under a project (respecting
//! `.gitignore`, via the `ignore` crate), parses them, and executes a
//! fully-resolved request server-side via `reqwest` — so the request runs
//! with the daemon's own network position, not the browser's (no CORS,
//! consistent behavior between the desktop and web clients).

use super::parser;
use crate::api_types::{HttpExecuteResponse, HttpFileParsed, HttpHeader, HttpRequestDef};
use std::collections::HashSet;
use std::path::Path;

const EXTENSIONS: &[&str] = &["http", "rest"];
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
/// `{{env_NAME}}` reads `NAME` straight from the project's `.env` (see dotenv.rs).
const ENV_PREFIX: &str = "env_";

pub async fn discover_and_parse(root: String) -> Vec<HttpFileParsed> {
    tokio::task::spawn_blocking(move || {
        let mut paths: Vec<std::path::PathBuf> = ignore::WalkBuilder::new(&root)
            .hidden(false)
            .build()
            .flatten()
            .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|entry| entry.into_path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()).map(|ext| EXTENSIONS.iter().any(|c| ext.eq_ignore_ascii_case(c))).unwrap_or(false))
            .collect();
        paths.sort();
        paths.into_iter().filter_map(|path| parse_file(&path)).collect()
    })
    .await
    .unwrap_or_default()
}

fn parse_file(path: &Path) -> Option<HttpFileParsed> {
    let content = std::fs::read_to_string(path).ok()?;
    let parsed = parser::parse(&content);
    let name = path.file_name()?.to_string_lossy().to_string();

    let requests = parsed
        .requests
        .into_iter()
        .map(|request| {
            let mut referenced = HashSet::new();
            referenced.extend(parser::referenced_variables(&request.url));
            for (_, value) in &request.headers {
                referenced.extend(parser::referenced_variables(value));
            }
            if let Some(body) = &request.body {
                referenced.extend(parser::referenced_variables(body));
            }
            let mut store_variables = Vec::new();
            let mut env_variables = Vec::new();
            for name in referenced {
                if parsed.variables.contains_key(&name) {
                    continue;
                }
                if name.starts_with(ENV_PREFIX) {
                    env_variables.push(name);
                } else {
                    store_variables.push(name);
                }
            }
            store_variables.sort();
            env_variables.sort();

            HttpRequestDef {
                name: request.name,
                method: request.method,
                url: request.url,
                headers: request.headers.into_iter().map(|(key, value)| HttpHeader { key, value }).collect(),
                body: request.body,
                store_variables,
                env_variables,
            }
        })
        .collect();

    Some(HttpFileParsed { path: path.to_string_lossy().to_string(), name, variables: parsed.variables, requests })
}

fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().unwrap_or_default())
}

fn failed(started: std::time::Instant, status: u16, message: impl Into<String>) -> HttpExecuteResponse {
    HttpExecuteResponse {
        ok: false,
        status,
        status_text: message.into(),
        headers: Vec::new(),
        body: String::new(),
        duration_ms: started.elapsed().as_millis() as u64,
        size_bytes: 0,
        truncated: false,
    }
}

pub async fn execute(method: &str, url: &str, headers: &[HttpHeader], body: Option<&str>) -> HttpExecuteResponse {
    let started = std::time::Instant::now();

    let Ok(parsed_method) = reqwest::Method::from_bytes(method.trim().to_uppercase().as_bytes()) else {
        return failed(started, 0, format!("Invalid HTTP method \"{method}\"."));
    };

    let mut builder = client().request(parsed_method, url);
    for header in headers {
        builder = builder.header(&header.key, &header.value);
    }
    if let Some(body) = body {
        builder = builder.body(body.to_string());
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => return failed(started, 0, error.to_string()),
    };

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or_default().to_string();
    let response_headers: Vec<HttpHeader> =
        response.headers().iter().map(|(key, value)| HttpHeader { key: key.to_string(), value: value.to_str().unwrap_or_default().to_string() }).collect();

    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            let mut result = failed(started, status, format!("Failed to read response body ({error})."));
            result.headers = response_headers;
            return result;
        }
    };

    let truncated = bytes.len() > MAX_RESPONSE_BYTES;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_RESPONSE_BYTES)]).into_owned();

    HttpExecuteResponse {
        ok: true,
        status,
        status_text,
        headers: response_headers,
        size_bytes: bytes.len() as u64,
        body: text,
        duration_ms: started.elapsed().as_millis() as u64,
        truncated,
    }
}
