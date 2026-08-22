//! Encryption for user-supplied provider keys.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Read, Write};

use anyhow::{Context, Result};
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use sha2::{Digest, Sha256};

use crate::config::Config;

const FORMAT_VERSION: u8 = 1;

pub fn encrypt(config: &Config, plaintext: &str, context: &[u8]) -> Result<String> {
    let key = load_key(config)?;
    let cipher = XChaCha20Poly1305::new(&Key::try_from(key.as_slice()).expect("32-byte key"));
    let mut nonce_bytes = [0u8; 24];
    getrandom::fill(&mut nonce_bytes).context("failed to create encryption nonce")?;
    let nonce = XNonce::try_from(nonce_bytes.as_slice()).expect("24-byte nonce");
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: context,
            },
        )
        .map_err(|_| anyhow::anyhow!("provider key encryption failed"))?;

    let mut encoded = Vec::with_capacity(1 + nonce_bytes.len() + ciphertext.len());
    encoded.push(FORMAT_VERSION);
    encoded.extend_from_slice(&nonce_bytes);
    encoded.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD_NO_PAD.encode(encoded))
}

pub fn decrypt(config: &Config, encoded: &str, context: &[u8]) -> Result<String> {
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(encoded)
        .context("stored provider key is not valid base64")?;
    if bytes.len() < 26 || bytes[0] != FORMAT_VERSION {
        anyhow::bail!("stored provider key has an unsupported format");
    }
    let key = load_key(config)?;
    let cipher = XChaCha20Poly1305::new(&Key::try_from(key.as_slice()).expect("32-byte key"));
    let nonce = XNonce::try_from(&bytes[1..25]).expect("validated 24-byte nonce");
    let plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &bytes[25..],
                aad: context,
            },
        )
        .map_err(|_| anyhow::anyhow!("stored provider key could not be decrypted"))?;
    String::from_utf8(plaintext).context("stored provider key is not UTF-8")
}

fn load_key(config: &Config) -> Result<[u8; 32]> {
    if let Ok(secret) = std::env::var("KINTARA_SECRET") {
        if secret.len() < 32 {
            anyhow::bail!("KINTARA_SECRET must be at least 32 characters");
        }
        return Ok(Sha256::digest(secret.as_bytes()).into());
    }

    let path = config.data_dir.join("kintara-ai.key");
    match read_key_file(&path) {
        Ok(key) => return Ok(key),
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(err).with_context(|| format!("failed to read {}", path.display())),
    }

    let mut key = [0u8; 32];
    getrandom::fill(&mut key).context("failed to generate installation encryption key")?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(&key)
                .with_context(|| format!("failed to write {}", path.display()))?;
            file.sync_all()
                .with_context(|| format!("failed to sync {}", path.display()))?;
            Ok(key)
        }
        Err(err) if err.kind() == ErrorKind::AlreadyExists => read_key_file(&path)
            .with_context(|| format!("failed to read concurrently-created {}", path.display())),
        Err(err) => Err(err).with_context(|| format!("failed to create {}", path.display())),
    }
}

fn read_key_file(path: &std::path::Path) -> std::io::Result<[u8; 32]> {
    let mut file = std::fs::File::open(path)?;
    let mut key = [0u8; 32];
    file.read_exact(&mut key)?;
    let mut extra = [0u8; 1];
    if file.read(&mut extra)? != 0 {
        return Err(std::io::Error::new(
            ErrorKind::InvalidData,
            "installation encryption key has the wrong length",
        ));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn config(dir: &tempfile::TempDir) -> Config {
        Config {
            library_dir: dir.path().join("library"),
            data_dir: dir.path().to_path_buf(),
            web_dir: dir.path().join("web"),
            bind: "127.0.0.1:0".parse().unwrap(),
            scan_on_start: false,
            watch: false,
            max_upload_bytes: 1024,
            github_oauth: None,
        }
    }

    #[test]
    fn provider_keys_round_trip_and_are_bound_to_their_owner() {
        let dir = tempfile::tempdir().unwrap();
        let config = config(&dir);
        let encrypted = encrypt(&config, "sk-secret", b"user:1:openai").unwrap();
        assert!(!encrypted.contains("sk-secret"));
        assert_eq!(
            decrypt(&config, &encrypted, b"user:1:openai").unwrap(),
            "sk-secret"
        );
        assert!(decrypt(&config, &encrypted, b"user:2:openai").is_err());
    }
}
