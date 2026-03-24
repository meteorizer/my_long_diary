# decrypt_diary.py
# /// script 
# dependencies: = [
#     "cryptography"
# ]
# ///

import sys
import os
from pathlib import Path

try:
    from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("Error: Missing required packages.")
    print("Please install the cryptography module by running:")
    print("  pip install cryptography")
    sys.exit(1)

def derive_key(password: str, salt: str) -> bytes:
    """
    Derives a 32-byte key from the password and salt using Argon2id.
    These parameters match Rust's argon2::Argon2::default() for v0.5.x.
    """
    kdf = Argon2id(
        salt=salt.encode('utf-8'),
        length=32,
        iterations=2,
        lanes=1,
        memory_cost=19456,
        ad=None,
        secret=None
    )
    return kdf.derive(password.encode('utf-8'))

def decrypt_file(file_path: Path, password: str, salt: str):
    """
    Decrypts a single file using AES-256-GCM.
    The Rust implementation prepends the 12-byte nonce to the ciphertext.
    """
    try:
        data = file_path.read_bytes()
        
        if len(data) < 12:
            print(f"Error: [{file_path.name}] is too short or not a valid encrypted diary.")
            return

        nonce = data[:12]
        ciphertext = data[12:]
        
        key = derive_key(password, salt)
        aesgcm = AESGCM(key)
        
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        print(f"=== Decrypted Content: {file_path.name} ===")
        print(plaintext.decode('utf-8', errors='replace'))
        print("=" * 50)
        
    except Exception as e:
        print(f"Failed to decrypt [{file_path.name}]. Wrong password or corrupted file? Error: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python decrypt_diary.py <diary_file_or_directory> [password]")
        sys.exit(1)

    target = Path(sys.argv[1])
    
    if not target.exists():
        print(f"Error: Target path does not exist - {target}")
        sys.exit(1)

    # Find the .app_salt file
    salt_path = None
    if target.is_dir():
        salt_path = target / ".app_salt"
    else:
        salt_path = target.parent / ".app_salt"

    if not salt_path or not salt_path.exists():
        print(f"Error: '.app_salt' file not found in {salt_path.parent}.")
        print("Without the salt, the diaries cannot be decrypted.")
        sys.exit(1)

    salt = salt_path.read_text(encoding='utf-8').strip()
    
    password = sys.argv[2] if len(sys.argv) > 2 else input("Enter your diary password: ")

    if target.is_dir():
        print(f"Scanning directory: {target} for .diary files...\n")
        diary_files = list(target.glob("*.diary"))
        if not diary_files:
            print("No .diary files found in the directory.")
        else:
            for file_path in diary_files:
                decrypt_file(file_path, password, salt)
    else:
        if target.suffix != ".diary":
            print("Warning: Target file does not have a .diary extension.")
        decrypt_file(target, password, salt)

if __name__ == "__main__":
    main()
