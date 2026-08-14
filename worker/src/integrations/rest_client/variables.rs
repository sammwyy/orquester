//! Per-project variable values for `.http`/`.rest` requests that aren't
//! defined by an `@name = value` in the file itself. AES-256-GCM encrypted
//! at rest under the daemon's own app dir (`$appdir/http-variables`) — never
//! inside the project, so never committed, and never sent to a client except
//! by name (`list_names`); values only ever leave this module already
//! substituted into an outgoing request (see routes::execute).

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::path::PathBuf;

fn store_dir(appdir: &str) -> PathBuf {
    PathBuf::from(appdir).join("http-variables")
}

fn key_path(appdir: &str) -> PathBuf {
    store_dir(appdir).join("key")
}

/// Project paths shouldn't appear in filenames, so name the store by a hash of it.
fn project_file(appdir: &str, project_path: &str) -> PathBuf {
    let mut hasher = Sha1::new();
    hasher.update(project_path.as_bytes());
    store_dir(appdir).join(format!("{:x}.enc", hasher.finalize()))
}

async fn load_or_create_key(appdir: &str) -> std::io::Result<Key<Aes256Gcm>> {
    tokio::fs::create_dir_all(store_dir(appdir)).await?;
    let path = key_path(appdir);
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if bytes.len() == 32 {
            return Ok(Key::<Aes256Gcm>::from_slice(&bytes).to_owned());
        }
    }
    let key = Aes256Gcm::generate_key(OsRng);
    tokio::fs::write(&path, key.as_slice()).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await;
    }
    Ok(key)
}

/// Decrypted variables for one project; empty (never an error) if none are configured yet.
pub async fn load(appdir: &str, project_path: &str) -> HashMap<String, String> {
    let Ok(key) = load_or_create_key(appdir).await else { return HashMap::new() };
    let Ok(raw) = tokio::fs::read(project_file(appdir, project_path)).await else { return HashMap::new() };
    if raw.len() < 12 {
        return HashMap::new();
    }
    let (nonce, ciphertext) = raw.split_at(12);
    let Ok(plaintext) = Aes256Gcm::new(&key).decrypt(Nonce::from_slice(nonce), ciphertext) else { return HashMap::new() };
    serde_json::from_slice(&plaintext).unwrap_or_default()
}

async fn save(appdir: &str, project_path: &str, map: &HashMap<String, String>) -> std::io::Result<()> {
    let key = load_or_create_key(appdir).await?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let plaintext = serde_json::to_vec(map).unwrap_or_default();
    let ciphertext = Aes256Gcm::new(&key).encrypt(&nonce, plaintext.as_slice()).map_err(|_| std::io::Error::other("Could not encrypt variables."))?;
    let mut out = nonce.to_vec();
    out.extend(ciphertext);
    tokio::fs::write(project_file(appdir, project_path), out).await
}

pub async fn list_names(appdir: &str, project_path: &str) -> Vec<String> {
    let mut names: Vec<String> = load(appdir, project_path).await.into_keys().collect();
    names.sort();
    names
}

pub async fn set(appdir: &str, project_path: &str, name: &str, value: &str) -> std::io::Result<()> {
    let mut map = load(appdir, project_path).await;
    map.insert(name.to_string(), value.to_string());
    save(appdir, project_path, &map).await
}

pub async fn delete(appdir: &str, project_path: &str, name: &str) -> std::io::Result<()> {
    let mut map = load(appdir, project_path).await;
    map.remove(name);
    save(appdir, project_path, &map).await
}
