//! Per-day diary history stored as immutable snapshot files.
//!
//! Layout (inside the diary directory):
//!   .history/<YYYY-MM-DD>/<UTC timestamp>_<device>_<kind>.md
//!
//! Every snapshot is written once and never modified, and its name is unique per
//! device, so two machines syncing the folder through OneDrive never write the
//! same file. The directory listing is the index; there is no shared index file.

use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub const HISTORY_DIR: &str = ".history";
const SNAPSHOT_EXT: &str = "md";
const TS_FORMAT: &str = "%Y%m%dT%H%M%S%3fZ";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SnapshotInfo {
    /// File name; used as the id when reading or restoring.
    pub id: String,
    /// Milliseconds since the Unix epoch (UTC).
    pub timestamp_ms: i64,
    pub device: String,
    pub kind: String,
}

/// True for a plain `YYYY-MM-DD` diary date (also guards against path traversal).
pub fn is_valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

fn check_date(date: &str) -> Result<(), String> {
    if is_valid_date(date) {
        Ok(())
    } else {
        Err(format!("Invalid diary date: {}", date))
    }
}

/// Name for file names: ASCII letters, digits and '-' only, never empty.
pub fn sanitize_label(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .trim_end_matches(".local")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .take(40)
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "device".to_string()
    } else {
        cleaned
    }
}

/// This computer's name, as used in snapshot file names.
pub fn device_name() -> String {
    sanitize_label(&gethostname::gethostname().to_string_lossy())
}

pub fn snapshot_dir(diary_dir: &Path, date: &str) -> PathBuf {
    diary_dir.join(HISTORY_DIR).join(date)
}

fn parse_name(name: &str) -> Option<SnapshotInfo> {
    let stem = name.strip_suffix(&format!(".{}", SNAPSHOT_EXT))?;
    let mut parts = stem.splitn(3, '_');
    let (ts, device, kind) = (parts.next()?, parts.next()?, parts.next()?);
    let parsed = NaiveDateTime::parse_from_str(ts, TS_FORMAT).ok()?;
    Some(SnapshotInfo {
        id: name.to_string(),
        timestamp_ms: parsed.and_utc().timestamp_millis(),
        device: device.to_string(),
        kind: kind.to_string(),
    })
}

/// All snapshots for a date, newest first. Missing folder means no history yet.
pub fn list(diary_dir: &Path, date: &str) -> Result<Vec<SnapshotInfo>, String> {
    check_date(date)?;
    let dir = snapshot_dir(diary_dir, date);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut snapshots: Vec<SnapshotInfo> = entries
        .flatten()
        .filter_map(|e| parse_name(&e.file_name().to_string_lossy()))
        .collect();
    // Name order is timestamp order; ties broken by device/kind so it is stable.
    snapshots.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(snapshots)
}

pub fn read(diary_dir: &Path, date: &str, id: &str) -> Result<String, String> {
    check_date(date)?;
    if parse_name(id).is_none() || id.contains(['/', '\\']) {
        return Err(format!("Invalid snapshot id: {}", id));
    }
    let bytes = fs::read(snapshot_dir(diary_dir, date).join(id))
        .map_err(|e| format!("기록을 읽을 수 없습니다 ({}): {}", id, e))?;
    String::from_utf8(bytes).map_err(|_| format!("기록 파일이 올바른 텍스트가 아닙니다: {}", id))
}

/// Content of the newest snapshot that can be read, if any.
/// An unreadable newest snapshot (e.g. OneDrive online-only) counts as "unknown"
/// and returns None, so callers simply take a fresh snapshot.
fn latest_content(diary_dir: &Path, date: &str) -> Result<Option<String>, String> {
    match list(diary_dir, date)?.first() {
        Some(info) => Ok(read(diary_dir, date, &info.id).ok()),
        None => Ok(None),
    }
}

pub fn has_snapshots(diary_dir: &Path, date: &str) -> Result<bool, String> {
    Ok(!list(diary_dir, date)?.is_empty())
}

fn write_new(dir: &Path, device: &str, kind: &str, bytes: &[u8]) -> Result<SnapshotInfo, String> {
    fs::create_dir_all(dir).map_err(|e| format!("기록 폴더를 만들 수 없습니다: {}", e))?;
    let kind = sanitize_label(kind);
    let mut now = Utc::now().naive_utc();
    loop {
        let name = format!("{}_{}_{}.{}", now.format(TS_FORMAT), device, kind, SNAPSHOT_EXT);
        let path = dir.join(&name);
        if path.exists() {
            now += chrono::Duration::milliseconds(1);
            continue;
        }
        let tmp = dir.join(format!("{}.tmp", name));
        fs::write(&tmp, bytes).map_err(|e| format!("기록을 쓸 수 없습니다: {}", e))?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("기록을 저장할 수 없습니다: {}", e)
        })?;
        return parse_name(&name).ok_or_else(|| "Snapshot name parse failed".to_string());
    }
}

/// Write a snapshot unless `content` equals the newest snapshot.
/// Returns the new snapshot, or None when nothing changed.
pub fn snapshot_if_changed(
    diary_dir: &Path,
    date: &str,
    content: &str,
    kind: &str,
    device: &str,
) -> Result<Option<SnapshotInfo>, String> {
    check_date(date)?;
    if latest_content(diary_dir, date)?.as_deref() == Some(content) {
        return Ok(None);
    }
    write_new(&snapshot_dir(diary_dir, date), device, kind, content.as_bytes()).map(Some)
}

/// OneDrive keeps both sides of an edit conflict as e.g. `2026-11-08-DESKTOP-ABC.diary`.
/// Move such copies into that date's history (kind "conflict") so the diary list stays
/// clean and nothing is lost. Returns the dates that had conflict copies.
pub fn import_conflict_copies(diary_dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(diary_dir) else {
        return Vec::new();
    };
    let mut dates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("diary") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.len() <= 10 || !stem.is_char_boundary(10) || !is_valid_date(&stem[..10]) {
            continue;
        }
        let (date, suffix) = stem.split_at(10);
        // Only text copies; anything else (e.g. leftover encrypted) is left untouched.
        let Ok(bytes) = fs::read(&path) else { continue };
        if std::str::from_utf8(&bytes).is_err() {
            continue;
        }
        let dir = snapshot_dir(diary_dir, date);
        if write_new(&dir, &sanitize_label(suffix), "conflict", &bytes).is_ok() {
            let _ = fs::remove_file(&path);
            if !dates.iter().any(|d| d == date) {
                dates.push(date.to_string());
            }
        }
    }
    dates.sort();
    dates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "diary_history_test_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validates_dates() {
        assert!(is_valid_date("2026-11-08"));
        assert!(!is_valid_date("2026-11-8"));
        assert!(!is_valid_date("../etc/xx"));
        assert!(!is_valid_date("2026-11-08-DESKTOP"));
    }

    #[test]
    fn sanitizes_labels() {
        assert_eq!(sanitize_label("Sangmins-MacBook-Pro.local"), "Sangmins-MacBook-Pro");
        assert_eq!(sanitize_label("DESKTOP_ABC 1"), "DESKTOP-ABC-1");
        assert_eq!(sanitize_label("-PC-ABC"), "PC-ABC");
        assert_eq!(sanitize_label("한글"), "device");
    }

    #[test]
    fn dedupes_against_latest_snapshot() {
        let dir = temp_dir("dedupe");
        let d = "2026-11-08";
        assert!(snapshot_if_changed(&dir, d, "a", "manual", "pc").unwrap().is_some());
        assert!(snapshot_if_changed(&dir, d, "a", "leave", "pc").unwrap().is_none());
        assert!(snapshot_if_changed(&dir, d, "b", "leave", "pc").unwrap().is_some());
        // Going back to an older content is a change relative to the latest.
        assert!(snapshot_if_changed(&dir, d, "a", "restore", "pc").unwrap().is_some());

        let all = list(&dir, d).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].kind, "restore");
        assert_eq!(read(&dir, d, &all[0].id).unwrap(), "a");
        assert_eq!(read(&dir, d, &all[1].id).unwrap(), "b");
        assert!(all[0].timestamp_ms >= all[1].timestamp_ms);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_bad_ids() {
        let dir = temp_dir("ids");
        assert!(read(&dir, "2026-11-08", "../../secret.md").is_err());
        assert!(read(&dir, "2026-11-08", "notasnapshot.md").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ignores_tmp_and_foreign_files() {
        let dir = temp_dir("foreign");
        let d = "2026-11-08";
        snapshot_if_changed(&dir, d, "x", "manual", "pc").unwrap();
        let sd = snapshot_dir(&dir, d);
        fs::write(sd.join("20261108T000000000Z_pc_manual.md.tmp"), "tmp").unwrap();
        fs::write(sd.join("desktop.ini"), "junk").unwrap();
        assert_eq!(list(&dir, d).unwrap().len(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn imports_onedrive_conflict_copies() {
        let dir = temp_dir("conflict");
        fs::write(dir.join("2026-11-08.diary"), "main").unwrap();
        fs::write(dir.join("2026-11-08-DESKTOP-ABC.diary"), "other side").unwrap();
        fs::write(dir.join("2026-11-07 2.diary"), "mac copy").unwrap();
        fs::write(dir.join("2026-11-06-PC.diary"), [0xffu8, 0xfe, 0x00]).unwrap();

        let dates = import_conflict_copies(&dir);
        assert_eq!(dates, vec!["2026-11-07", "2026-11-08"]);
        assert!(dir.join("2026-11-08.diary").exists());
        assert!(!dir.join("2026-11-08-DESKTOP-ABC.diary").exists());
        assert!(dir.join("2026-11-06-PC.diary").exists(), "non-text copy left alone");

        let snaps = list(&dir, "2026-11-08").unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!((snaps[0].device.as_str(), snaps[0].kind.as_str()), ("DESKTOP-ABC", "conflict"));
        assert_eq!(read(&dir, "2026-11-08", &snaps[0].id).unwrap(), "other side");
        fs::remove_dir_all(&dir).unwrap();
    }
}
