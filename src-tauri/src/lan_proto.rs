// The wire format between Elytra on a computer and Elytra on a phone.
// This file is the same in ember-desktop and ember-mobile.
//
// Everything after pairing is sealed with AES-256-GCM under a key only the two
// devices hold. Pairing itself is sealed under a key stretched from the code
// the computer shows (PBKDF2), which is never sent, so someone listening on
// the network learns nothing they can use without guessing the code.

// Each app uses only its own half of this file.
#![allow(dead_code)]

use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::Aes256Gcm;
use base64::Engine;

pub const DISCOVERY_PORT: u16 = 47820;
pub const SERVER_PORT: u16 = 47821;
pub const DISCOVERY_ASK: &[u8] = b"EMBER-DISCOVER-1";
pub const PAIR_ROUNDS: u32 = 150_000;
/// How old a sealed request may be before it is refused.
pub const MAX_AGE_SECS: u64 = 120;

/// Crockford's base32: no I, L, O or U, so a code reads back without doubt.
const CODE_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub type Key = [u8; 32];

pub fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn unb64(text: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(|_| "Garbled message.".to_string())
}

pub fn random_key() -> Key {
    rand::random()
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Ten characters, 50 bits, shown as "ABCDE-FGHJK".
pub fn new_pairing_code() -> String {
    let bytes: [u8; 10] = rand::random();
    let code: String = bytes
        .iter()
        .map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char)
        .collect();
    format!("{}-{}", &code[..5], &code[5..])
}

/// Upper case, separators dropped, and the look-alikes read the way they were meant.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect()
}

pub fn pairing_key(code: &str, desktop_id: &str) -> Key {
    let mut key = [0u8; 32];
    let salt = format!("ember-lan-pair-v1:{desktop_id}");
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(normalize_code(code).as_bytes(), salt.as_bytes(), PAIR_ROUNDS, &mut key);
    key
}

/// nonce (12 bytes) followed by the ciphertext and tag.
pub fn seal(key: &Key, context: &str, plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce: [u8; 12] = rand::random();
    let mut sealed = plaintext.to_vec();
    cipher
        .encrypt_in_place((&nonce).into(), context.as_bytes(), &mut sealed)
        .expect("AES-GCM encryption cannot fail for in-memory buffers");
    let mut out = Vec::with_capacity(12 + sealed.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    out
}

pub fn open(key: &Key, context: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 + 16 {
        return Err("Garbled message.".into());
    }
    let cipher = Aes256Gcm::new(key.into());
    let nonce: [u8; 12] = data[..12].try_into().expect("checked length");
    let mut plain = data[12..].to_vec();
    cipher
        .decrypt_in_place((&nonce).into(), context.as_bytes(), &mut plain)
        .map_err(|_| "The message couldn't be unlocked. Pair the devices again.".to_string())?;
    Ok(plain)
}

pub fn key_from_b64(text: &str) -> Result<Key, String> {
    unb64(text)?
        .try_into()
        .map_err(|_| "Stored key has the wrong length.".to_string())
}

// Contexts bind each sealed message to its purpose, so one can't be replayed as another.
pub fn pair_context(phone_id: &str) -> String {
    format!("ember-pair-v1:{phone_id}")
}
pub fn pair_reply_context(phone_id: &str) -> String {
    format!("ember-pair-reply-v1:{phone_id}")
}
pub fn call_context(path: &str, phone_id: &str) -> String {
    format!("ember-call-v1:{path}:{phone_id}")
}
pub fn reply_context(request_id: &str) -> String {
    format!("ember-reply-v1:{request_id}")
}
pub fn frame_context(request_id: &str, seq: u64) -> String {
    format!("ember-chat-v1:{request_id}:{seq}")
}

// Chat replies stream as frames: 4-byte big-endian length, then a sealed
// payload whose first byte says what it is.
pub const FRAME_STATUS: u8 = b'S';
pub const FRAME_DATA: u8 = b'D';
pub const FRAME_END: u8 = b'E';
pub const FRAME_ERROR: u8 = b'X';

pub fn frame(key: &Key, request_id: &str, seq: u64, kind: u8, data: &[u8]) -> Vec<u8> {
    let mut plain = Vec::with_capacity(1 + data.len());
    plain.push(kind);
    plain.extend_from_slice(data);
    let sealed = seal(key, &frame_context(request_id, seq), &plain);
    let mut out = Vec::with_capacity(4 + sealed.len());
    out.extend_from_slice(&(sealed.len() as u32).to_be_bytes());
    out.extend_from_slice(&sealed);
    out
}

/// Pulls whole frames off the front of `buffer`, in order.
pub struct FrameReader {
    key: Key,
    request_id: String,
    seq: u64,
    buffer: Vec<u8>,
}

impl FrameReader {
    pub fn new(key: Key, request_id: &str) -> Self {
        Self { key, request_id: request_id.to_string(), seq: 0, buffer: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    pub fn next(&mut self) -> Result<Option<(u8, Vec<u8>)>, String> {
        if self.buffer.len() < 4 {
            return Ok(None);
        }
        let len = u32::from_be_bytes(self.buffer[..4].try_into().expect("checked length")) as usize;
        if len > 16 * 1024 * 1024 {
            return Err("Garbled message.".into());
        }
        if self.buffer.len() < 4 + len {
            return Ok(None);
        }
        let sealed: Vec<u8> = self.buffer.drain(..4 + len).skip(4).collect();
        let plain = open(&self.key, &frame_context(&self.request_id, self.seq), &sealed)?;
        self.seq += 1;
        let (kind, data) = plain.split_first().ok_or("Garbled message.")?;
        Ok(Some((*kind, data.to_vec())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_round_trips_and_binds_context() {
        let key = random_key();
        let sealed = seal(&key, "a", b"hello");
        assert_eq!(open(&key, "a", &sealed).unwrap(), b"hello");
        assert!(open(&key, "b", &sealed).is_err());
        assert!(open(&random_key(), "a", &sealed).is_err());
    }

    #[test]
    fn codes_survive_retyping() {
        let code = new_pairing_code();
        assert_eq!(code.len(), 11);
        let typed = code.to_lowercase().replace('-', " ").replace('0', "o").replace('1', "l");
        assert_eq!(pairing_key(&typed, "pc"), pairing_key(&code, "pc"));
        assert_ne!(pairing_key(&code, "pc"), pairing_key(&code, "other-pc"));
    }

    #[test]
    fn frames_arrive_in_order_across_chunks() {
        let key = random_key();
        let mut wire = frame(&key, "r1", 0, FRAME_STATUS, b"{}");
        wire.extend(frame(&key, "r1", 1, FRAME_DATA, b"line\n"));
        wire.extend(frame(&key, "r1", 2, FRAME_END, b""));
        let mut reader = FrameReader::new(key, "r1");
        let mut got = Vec::new();
        for chunk in wire.chunks(7) {
            reader.push(chunk);
            while let Some(f) = reader.next().unwrap() {
                got.push(f);
            }
        }
        assert_eq!(got.len(), 3);
        assert_eq!(got[1], (FRAME_DATA, b"line\n".to_vec()));

        // A dropped frame breaks the sequence instead of passing silently.
        let mut skipped = frame(&key, "r1", 0, FRAME_DATA, b"a");
        skipped.extend(frame(&key, "r1", 2, FRAME_END, b""));
        let mut reader = FrameReader::new(key, "r1");
        reader.push(&skipped);
        assert!(reader.next().unwrap().is_some());
        assert!(reader.next().is_err());
    }
}
