# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "cryptography>=42",
# ]
# ///
"""
My Long Diary 일괄 암호 해제 도구.

암호화 기능이 제거된 앱 버전으로 넘어가기 전에, 기존에 AES-256-GCM 으로
암호화된 *.diary 파일을 모두 평문(UTF-8 마크다운)으로 되돌린다.

사용법:
    uv run scripts/decrypt_diary.py <일기_폴더>            # 미리보기 (아무것도 바꾸지 않음)
    uv run scripts/decrypt_diary.py <일기_폴더> --apply    # 백업 후 실제 변환

동작:
    1. 입력한 비밀번호와 후보 솔트들로 키를 만든다 (Argon2id, Rust argon2 0.5 기본값).
       후보 솔트: 폴더의 .app_salt, 앱 설정 파일(신/구버전)의 password_salt, --salt 로 준 값.
       비밀번호를 바꾼 적이 있으면 예전 파일은 예전 솔트로 잠겨 있기 때문이다.
    2. 각 .diary 파일을 분류한다.
         - encrypted  : 어느 한 키로 복호화 성공 (GCM 인증 통과) -> 평문으로 변환 대상
         - plain      : 복호화 실패, 올바른 UTF-8               -> 이미 평문, 그대로 둠
         - failed     : 둘 다 아님 (다른 비밀번호/솔트, 손상)    -> 건드리지 않음
         - unreadable : 파일을 읽을 수 없음 (주로 OneDrive 온라인 전용 파일)
    3. --apply 이면 폴더 전체를 형제 폴더로 백업한 뒤, 변환 대상을 원자적으로 덮어쓴다.
       읽을 수 없는 파일이 있으면 백업이 불완전해지므로 아무것도 바꾸지 않고 중단한다.
    4. failed 가 하나도 없을 때만 .app_salt 를 삭제한다.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

try:
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
except ImportError:
    print("cryptography 패키지가 필요합니다. 다음처럼 실행하세요:")
    print("  uv run scripts/decrypt_diary.py <일기_폴더>")
    sys.exit(1)

NONCE_LEN = 12
GCM_TAG_LEN = 16
SALT_FILE = ".app_salt"
# 앱이 password_salt 를 저장하던 설정 폴더 (%APPDATA% 아래, 신버전 / 구버전 tauri-app)
APP_CONFIG_IDS = ("com.meteo.mylongdiary", "com.meteo.tauri-app")


def derive_key(password: str, salt: str) -> bytes:
    """Rust `argon2::Argon2::default()` (v0.5: Argon2id, m=19456, t=2, p=1) 와 동일한 키 유도."""
    kdf = Argon2id(
        salt=salt.encode("utf-8"),
        length=32,
        iterations=2,
        lanes=1,
        memory_cost=19456,
    )
    return kdf.derive(password.encode("utf-8"))


def try_decrypt(data: bytes, aes: AESGCM) -> str | None:
    """[Nonce(12)][Ciphertext+Tag] 형식 복호화. 실패하면 None."""
    if len(data) < NONCE_LEN + GCM_TAG_LEN:
        return None
    try:
        plaintext = aes.decrypt(data[:NONCE_LEN], data[NONCE_LEN:], None)
    except InvalidTag:
        return None
    try:
        return plaintext.decode("utf-8")
    except UnicodeDecodeError:
        return None


def is_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def candidate_salts(diary_dir: Path, extra: list[str]) -> list[tuple[str, str]]:
    """(출처, 솔트) 목록. 중복 제거, .app_salt 가 가장 먼저."""
    found: list[tuple[str, str]] = []
    salt_path = diary_dir / SALT_FILE
    if salt_path.exists():
        found.append((SALT_FILE, salt_path.read_text(encoding="utf-8").strip()))
    appdata = os.environ.get("APPDATA")
    if appdata:
        for app_id in APP_CONFIG_IDS:
            cfg = Path(appdata) / app_id / "settings.json"
            try:
                salt = json.loads(cfg.read_text(encoding="utf-8")).get("password_salt")
            except (OSError, ValueError):
                continue
            if isinstance(salt, str):
                found.append((f"{app_id}/settings.json", salt.strip()))
    found.extend(("--salt", s.strip()) for s in extra)

    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for source, salt in found:
        if salt and salt not in seen:
            seen.add(salt)
            unique.append((source, salt))
    return unique


@dataclass
class Scan:
    encrypted: dict[Path, str] = field(default_factory=dict)  # path -> plaintext
    plain: list[Path] = field(default_factory=list)
    failed: list[Path] = field(default_factory=list)
    unreadable: dict[Path, str] = field(default_factory=dict)  # path -> error
    by_salt: dict[str, int] = field(default_factory=dict)  # salt source -> count


def scan(diary_dir: Path, keys: list[tuple[str, bytes]]) -> Scan:
    ciphers = [(source, AESGCM(key)) for source, key in keys]
    result = Scan()
    for path in sorted(diary_dir.glob("*.diary")):
        if not path.is_file():
            continue
        try:
            data = path.read_bytes()
        except OSError as e:
            result.unreadable[path] = str(e)
            continue
        text = None
        for source, aes in ciphers:
            text = try_decrypt(data, aes)
            if text is not None:
                result.by_salt[source] = result.by_salt.get(source, 0) + 1
                break
        if text is not None:
            result.encrypted[path] = text
        elif is_utf8(data):
            result.plain.append(path)
        else:
            result.failed.append(path)
    return result


def atomic_write_text(path: Path, text: str) -> None:
    """앱의 save_diary 와 같은 방식: .tmp 에 쓰고 rename."""
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(text.encode("utf-8"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def make_backup(diary_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = diary_dir.with_name(f"{diary_dir.name}_backup_{stamp}")
    shutil.copytree(diary_dir, backup)
    return backup


def print_summary(result: Scan) -> None:
    print(f"  암호화됨 (해제 대상) : {len(result.encrypted)}개")
    print(f"  이미 평문            : {len(result.plain)}개")
    print(f"  해제 실패            : {len(result.failed)}개")
    print(f"  읽기 불가            : {len(result.unreadable)}개")
    if any(source != SALT_FILE for source in result.by_salt):
        print("\n  솔트별 해제 개수:")
        for source, count in result.by_salt.items():
            print(f"    - {source}: {count}개")
    if result.unreadable:
        print("\n  읽을 수 없는 파일:")
        for p, err in result.unreadable.items():
            print(f"    - {p.name}  ({err})")
        print(
            "  OneDrive 온라인 전용 파일이면 OneDrive 가 실행·로그인돼 있는지 확인하고,\n"
            "  탐색기에서 일기 폴더를 우클릭 → '항상 이 디바이스에 유지' 로 내려받은 뒤 다시 실행하세요."
        )
    if result.failed:
        print("\n  해제할 수 없는 파일 (다른 비밀번호/솔트로 암호화됐거나 손상됨):")
        for p in result.failed:
            print(f"    - {p.name}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="My Long Diary 일괄 암호 해제")
    parser.add_argument("diary_dir", type=Path, help=".diary 파일과 .app_salt 가 있는 일기 폴더")
    parser.add_argument("--apply", action="store_true", help="백업 후 실제로 평문으로 변환")
    parser.add_argument("--yes", action="store_true", help="--apply 시 확인 질문 생략")
    parser.add_argument(
        "--salt",
        action="append",
        default=[],
        help="추가로 시도할 솔트 (여러 번 지정 가능)",
    )
    parser.add_argument(
        "--password",
        help="비밀번호 (생략하면 안전하게 입력받음. 지정하면 셸 기록에 남을 수 있음)",
    )
    args = parser.parse_args()

    diary_dir: Path = args.diary_dir.resolve()
    if not diary_dir.is_dir():
        print(f"폴더가 없습니다: {diary_dir}")
        return 1

    if not (diary_dir / SALT_FILE).exists():
        print(f"{SALT_FILE} 파일이 없습니다. 이 폴더는 암호화된 적이 없거나 이미 해제되었습니다.")
        return 0

    salts = candidate_salts(diary_dir, args.salt)
    if not salts:
        print(f"{SALT_FILE} 파일이 비어 있고 다른 솔트 후보도 없습니다.")
        return 1

    password = args.password if args.password is not None else getpass.getpass("일기 비밀번호: ")
    print(f"키 생성 중... (솔트 후보 {len(salts)}개)")
    keys = [(source, derive_key(password, salt)) for source, salt in salts]

    result = scan(diary_dir, keys)
    print(f"\n[{diary_dir}] 검사 결과")
    print_summary(result)

    if not result.encrypted and result.failed:
        print(
            "\n이번 실행에서 복호화된 파일이 없습니다. 비밀번호가 틀렸거나,"
            "\n남은 파일이 다른 비밀번호로 잠겨 있습니다. 중단합니다."
        )
        return 1

    if args.apply and result.unreadable:
        print("\n읽을 수 없는 파일이 있어 백업을 완전하게 만들 수 없습니다. 아무것도 바꾸지 않고 중단합니다.")
        return 1

    if not args.apply:
        print("\n미리보기만 했습니다. 실제로 변환하려면 --apply 를 붙여 다시 실행하세요.")
        return 0

    if not args.yes:
        answer = input(f"\n{len(result.encrypted)}개 파일을 평문으로 바꿉니다. 진행할까요? [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            print("취소했습니다.")
            return 0

    backup = make_backup(diary_dir)
    print(f"\n백업 완료: {backup}")

    for path, text in result.encrypted.items():
        atomic_write_text(path, text)
    print(f"{len(result.encrypted)}개 파일을 평문으로 변환했습니다.")

    if result.failed:
        print(
            f"\n해제하지 못한 파일이 {len(result.failed)}개 있어 {SALT_FILE} 는 남겨 두었습니다."
            "\n원본은 백업 폴더에도 있습니다."
        )
        return 2

    (diary_dir / SALT_FILE).unlink()
    print(f"{SALT_FILE} 를 삭제했습니다. 이제 암호화 없는 앱 버전에서 모든 일기를 열 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
