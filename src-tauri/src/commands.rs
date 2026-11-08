use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::history;
use crate::settings;

/// Marker file left by the old encrypted version of the app.
/// Removed by `scripts/decrypt_diary.py` once every diary is decrypted.
const LEGACY_SALT_FILE: &str = ".app_salt";

// Helper struct for Diary Entries
#[derive(Debug, Serialize, Deserialize)]
pub struct DiaryEntry {
    pub date: String,
    pub content: String,
}

// 1. Get the directory for storing diaries
#[tauri::command]
pub fn get_diary_dir(app: AppHandle) -> Result<String, String> {
    let app_settings = settings::load_settings(&app);
    if app_settings.diary_directory.is_empty() {
        return Err("Diary directory is not set".into());
    }
    let app_dir = PathBuf::from(&app_settings.diary_directory);
    
    // Create it if it doesn't exist
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    Ok(app_dir.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckDirectoryResult {
    /// True if the folder still holds diaries from the old encrypted version (.app_salt exists).
    pub is_encrypted: bool,
}

#[tauri::command]
pub fn check_directory(directory: String) -> Result<CheckDirectoryResult, String> {
    let is_encrypted = PathBuf::from(&directory).join(LEGACY_SALT_FILE).exists();
    Ok(CheckDirectoryResult { is_encrypted })
}

#[derive(Debug, Serialize)]
pub struct DiaryList {
    /// Diary dates (YYYY-MM-DD), newest first.
    pub dates: Vec<String>,
    /// Dates whose OneDrive conflict copies were just moved into history.
    pub conflicts_imported: Vec<String>,
}

// 2. List all available diaries (files named YYYY-MM-DD.diary)
#[tauri::command]
pub fn list_diaries(app: AppHandle) -> Result<DiaryList, String> {
    let dir_path = PathBuf::from(get_diary_dir(app)?);
    let conflicts_imported = history::import_conflict_copies(&dir_path);

    let mut dates: Vec<String> = fs::read_dir(&dir_path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("diary"))
        .filter_map(|path| path.file_stem().and_then(|s| s.to_str()).map(str::to_string))
        .filter(|stem| history::is_valid_date(stem))
        .collect();

    // Sort descending (newest first)
    dates.sort_by(|a, b| b.cmp(a));

    Ok(DiaryList { dates, conflicts_imported })
}

fn diary_path(dir: &Path, date: &str) -> Result<PathBuf, String> {
    if !history::is_valid_date(date) {
        return Err(format!("Invalid diary date: {}", date));
    }
    Ok(dir.join(format!("{}.diary", date)))
}

/// Current text of a diary; None if the file does not exist.
fn read_text(dir: &Path, date: &str) -> Result<Option<String>, String> {
    let file_path = diary_path(dir, date)?;
    if !file_path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    String::from_utf8(bytes).map(Some).map_err(|_| {
        "암호화된 일기입니다. scripts/decrypt_diary.py 로 암호를 해제한 뒤 다시 열어 주세요.".to_string()
    })
}

/// Atomically write a diary, then snapshot it when `snapshot_kind` is given.
fn write_diary(
    dir: &Path,
    date: &str,
    content: &str,
    snapshot_kind: Option<&str>,
) -> Result<Option<history::SnapshotInfo>, String> {
    let file_path = diary_path(dir, date)?;
    let temp_file_path = dir.join(format!("{}.diary.tmp", date));

    // Never overwrite a diary still encrypted by the old app version (read_text
    // fails on it): it would be read back as empty and the original would be lost.
    let existing = read_text(dir, date).map_err(|_| {
        "암호화된 일기는 덮어쓸 수 없습니다. scripts/decrypt_diary.py 로 먼저 암호를 해제해 주세요.".to_string()
    })?;
    // Diaries written before history existed get a baseline before their first change.
    if let Some(existing) = existing {
        if existing != content && !history::has_snapshots(dir, date)? {
            history::snapshot_if_changed(dir, date, &existing, "baseline", &history::device_name())?;
        }
    }

    fs::write(&temp_file_path, content.as_bytes())
        .map_err(|e| format!("Failed to write temporary file: {}", e))?;
    fs::rename(&temp_file_path, &file_path).map_err(|e| {
        let _ = fs::remove_file(&temp_file_path);
        format!("Failed to save file atomically: {}", e)
    })?;

    match snapshot_kind {
        Some(kind) => history::snapshot_if_changed(dir, date, content, kind, &history::device_name()),
        None => Ok(None),
    }
}

#[derive(Debug, Serialize)]
pub struct ReadDiaryResult {
    pub content: String,
    /// The file changed since the app last recorded it (external editor, sync,
    /// or a crash before the last snapshot). The current content was snapshotted.
    pub external_change: bool,
}

// 3. Read a specific diary entry by date (filename)
#[tauri::command]
pub fn read_diary(app: AppHandle, date: String) -> Result<ReadDiaryResult, String> {
    let dir = PathBuf::from(get_diary_dir(app)?);
    read_with_history(&dir, &date)
}

fn read_with_history(dir: &Path, date: &str) -> Result<ReadDiaryResult, String> {
    let (dir, date) = (dir.to_path_buf(), date.to_string());
    let Some(content) = read_text(&dir, &date)? else {
        return Ok(ReadDiaryResult { content: String::new(), external_change: false });
    };

    // The app snapshots whenever it finishes editing, so the file should match the
    // newest snapshot. A diary with no history yet just gets its baseline.
    let had_history = history::has_snapshots(&dir, &date)?;
    let kind = if had_history { "external" } else { "baseline" };
    let created = history::snapshot_if_changed(&dir, &date, &content, kind, &history::device_name())?;

    Ok(ReadDiaryResult { content, external_change: had_history && created.is_some() })
}

// 4. Save a diary entry (Atomic save). `snapshot` is the history kind to record
// (e.g. "manual", "leave", "periodic"); None for a plain autosave.
#[tauri::command]
pub fn save_diary(
    app: AppHandle,
    date: String,
    content: String,
    snapshot: Option<String>,
) -> Result<Option<history::SnapshotInfo>, String> {
    let dir = PathBuf::from(get_diary_dir(app)?);
    write_diary(&dir, &date, &content, snapshot.as_deref())
}

#[tauri::command]
pub fn list_snapshots(app: AppHandle, date: String) -> Result<Vec<history::SnapshotInfo>, String> {
    let dir = PathBuf::from(get_diary_dir(app)?);
    history::list(&dir, &date)
}

#[tauri::command]
pub fn read_snapshot(app: AppHandle, date: String, id: String) -> Result<String, String> {
    let dir = PathBuf::from(get_diary_dir(app)?);
    history::read(&dir, &date, &id)
}

/// Replace the diary with a snapshot's content. The current content is kept as a
/// "backup" snapshot first, and the restored content is recorded as "restore".
#[tauri::command]
pub fn restore_snapshot(app: AppHandle, date: String, id: String) -> Result<String, String> {
    let dir = PathBuf::from(get_diary_dir(app)?);
    restore(&dir, &date, &id)
}

fn restore(dir: &Path, date: &str, id: &str) -> Result<String, String> {
    let restored = history::read(dir, date, id)?;
    if let Some(current) = read_text(dir, date)? {
        history::snapshot_if_changed(dir, date, &current, "backup", &history::device_name())?;
    }
    write_diary(dir, date, &restored, Some("restore"))?;
    Ok(restored)
}

// 5. Import old diaries
#[tauri::command]
pub fn import_diaries(app: AppHandle, source_dir: String) -> Result<usize, String> {
    let source_path = PathBuf::from(&source_dir);
    if !source_path.exists() || !source_path.is_dir() {
        return Err("Source directory does not exist or is not a directory".into());
    }
    let diary_dir = PathBuf::from(get_diary_dir(app)?);

    let entries = fs::read_dir(source_path).map_err(|e| e.to_string())?;
    
    // Regex for YYYY-MM-DD and YYYYMMDD
    let re_dashed = regex::Regex::new(r"^(\d{4})-(\d{2})-(\d{2})$").unwrap();
    let re_compact = regex::Regex::new(r"^(\d{4})(\d{2})(\d{2})$").unwrap();

    let mut imported_count = 0;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "txt" && ext != "md" {
                continue;
            }

            if let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) {
                let mut valid_date = None;
                
                if re_dashed.is_match(file_stem) {
                    valid_date = Some(file_stem.to_string());
                } else if let Some(caps) = re_compact.captures(file_stem) {
                    // Convert YYYYMMDD to YYYY-MM-DD
                    if let (Some(y), Some(m), Some(d)) = (caps.get(1), caps.get(2), caps.get(3)) {
                        valid_date = Some(format!("{}-{}-{}", y.as_str(), m.as_str(), d.as_str()));
                    }
                }

                if let Some(date_str) = valid_date {
                    // Read old content
                    if let Ok(content) = fs::read_to_string(&path) {
                        // Keep what was there before the import in history.
                        if let Ok(Some(current)) = read_text(&diary_dir, &date_str) {
                            let _ = history::snapshot_if_changed(
                                &diary_dir, &date_str, &current, "backup", &history::device_name(),
                            );
                        }
                        if write_diary(&diary_dir, &date_str, &content, Some("import")).is_ok() {
                            imported_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(imported_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    const D: &str = "2026-11-01";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("diary_cmd_test_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn kinds(dir: &Path) -> Vec<String> {
        history::list(dir, D).unwrap().into_iter().rev().map(|s| s.kind).collect()
    }

    #[test]
    fn legacy_diary_gets_baseline_on_first_read_only() {
        let dir = temp_dir("baseline");
        fs::write(dir.join(format!("{D}.diary")), "old text").unwrap();
        let r = read_with_history(&dir, D).unwrap();
        assert_eq!((r.content.as_str(), r.external_change), ("old text", false));
        assert!(!read_with_history(&dir, D).unwrap().external_change);
        assert_eq!(kinds(&dir), vec!["baseline"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_external_edit_on_read() {
        let dir = temp_dir("external");
        write_diary(&dir, D, "v1", Some("manual")).unwrap();
        assert!(!read_with_history(&dir, D).unwrap().external_change);
        fs::write(dir.join(format!("{D}.diary")), "edited in notepad").unwrap();
        assert!(read_with_history(&dir, D).unwrap().external_change);
        assert!(!read_with_history(&dir, D).unwrap().external_change, "reported once");
        assert_eq!(kinds(&dir), vec!["manual", "external"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn autosave_without_snapshot_then_leave() {
        let dir = temp_dir("autosave");
        write_diary(&dir, D, "a", Some("manual")).unwrap();
        assert!(write_diary(&dir, D, "ab", None).unwrap().is_none());
        assert!(write_diary(&dir, D, "abc", None).unwrap().is_none());
        assert!(write_diary(&dir, D, "abc", Some("leave")).unwrap().is_some());
        assert!(write_diary(&dir, D, "abc", Some("leave")).unwrap().is_none(), "deduped");
        assert_eq!(kinds(&dir), vec!["manual", "leave"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn editing_legacy_diary_keeps_original_as_baseline() {
        let dir = temp_dir("legacy_edit");
        fs::write(dir.join(format!("{D}.diary")), "original").unwrap();
        write_diary(&dir, D, "changed", None).unwrap();
        let snaps = history::list(&dir, D).unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(history::read(&dir, D, &snaps[0].id).unwrap(), "original");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn restore_backs_up_current_content() {
        let dir = temp_dir("restore");
        write_diary(&dir, D, "first", Some("manual")).unwrap();
        let first_id = history::list(&dir, D).unwrap()[0].id.clone();
        write_diary(&dir, D, "second", Some("manual")).unwrap();
        write_diary(&dir, D, "second, unsnapshotted", None).unwrap();

        assert_eq!(restore(&dir, D, &first_id).unwrap(), "first");
        assert_eq!(read_text(&dir, D).unwrap().as_deref(), Some("first"));
        assert_eq!(kinds(&dir), vec!["manual", "manual", "backup", "restore"]);
        let backup = &history::list(&dir, D).unwrap()[1];
        assert_eq!(history::read(&dir, D, &backup.id).unwrap(), "second, unsnapshotted");
        assert!(!read_with_history(&dir, D).unwrap().external_change);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn never_overwrites_encrypted_diary() {
        let dir = temp_dir("encrypted");
        let path = dir.join(format!("{D}.diary"));
        fs::write(&path, [0x9cu8, 0xff, 0x00, 0x13]).unwrap();
        assert!(read_with_history(&dir, D).is_err());
        assert!(write_diary(&dir, D, "", Some("manual")).is_err());
        assert_eq!(fs::read(&path).unwrap(), vec![0x9cu8, 0xff, 0x00, 0x13]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_path_traversal_dates() {
        let dir = temp_dir("traversal");
        assert!(write_diary(&dir, "../evil", "x", None).is_err());
        assert!(read_with_history(&dir, r"..\evil").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
