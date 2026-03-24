use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2,
};
use aes_gcm::aead::rand_core::RngCore;

// 12-byte nonce for AES-GCM
const NONCE_LEN: usize = 12;

/// Derive a 256-bit (32 byte) key from a password and a salt using Argon2
pub fn derive_key(password: &str, salt: &str) -> Result<[u8; 32], String> {

    
    // We expect the salt here to be the parsed Output string. But Argon2 default API uses PasswordHasher trait.
    // For raw key derivation, we can use Argon2::hash_password, but it's simpler to use the raw memory if needed.
    // Instead of using complex traits, let's use the low-level `hash_password` method or `hash_password_into`.
    
    let salt_bytes = salt.as_bytes();
    let mut key = [0u8; 32];
    
    // Call Argon2 raw key derivation
    // The standard recommends Argon2id
    let argon2 = argon2::Argon2::default();
    argon2.hash_password_into(password.as_bytes(), salt_bytes, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
        
    Ok(key)
}

/// Generate a new random 16-byte salt, returned as a hex string or Base64
pub fn generate_salt() -> String {
    let salt = SaltString::generate(&mut OsRng);
    salt.to_string()
}

/// Encrypt plaintext using AES-256-GCM. 
/// Returns `[Nonce(12)][Ciphertext]` as a combined byte vector.
pub fn encrypt(plaintext: &str, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes); // 96-bits; unique per message

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;
        
    let mut result = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    
    Ok(result)
}

/// Decrypt ciphertext using AES-256-GCM.
/// Input must be `[Nonce(12)][Ciphertext]`
pub fn decrypt(encrypted_data: &[u8], key: &[u8; 32]) -> Result<String, String> {
    if encrypted_data.len() < NONCE_LEN {
        return Err("Encrypted data is too short (missing nonce)".into());
    }
    
    let (nonce_bytes, ciphertext) = encrypted_data.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(key.into());
    
    let plaintext_bytes = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
        
    String::from_utf8(plaintext_bytes).map_err(|e| format!("Invalid UTF-8 in decrypted data: {}", e))
}
