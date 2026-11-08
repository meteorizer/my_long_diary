use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

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

// 2. List all available diaries (files ending in .diary)
#[tauri::command]
pub fn list_diaries(app: AppHandle) -> Result<Vec<String>, String> {
    let dir_str = get_diary_dir(app)?;
    let dir_path = PathBuf::from(dir_str);
    
    let mut diaries = Vec::new();
    
    if dir_path.exists() {
        let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;
        
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("diary") {
                    if let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) {
                        diaries.push(file_stem.to_string());
                    }
                }
            }
        }
    }
    
    // Sort descending (newest first)
    diaries.sort_by(|a, b| b.cmp(a));
    
    Ok(diaries)
}

// 3. Read a specific diary entry by date (filename)
#[tauri::command]
pub fn read_diary(app: AppHandle, date: String) -> Result<String, String> {
    let dir_str = get_diary_dir(app)?;
    let file_path = PathBuf::from(dir_str).join(format!("{}.diary", date));

    if !file_path.exists() {
        return Ok(String::new()); // Return empty if not found
    }

    let file_content = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    String::from_utf8(file_content).map_err(|_| {
        "암호화된 일기입니다. scripts/decrypt_diary.py 로 암호를 해제한 뒤 다시 열어 주세요.".to_string()
    })
}

// 4. Save a diary entry (Atomic save)
#[tauri::command]
pub fn save_diary(app: AppHandle, date: String, content: String) -> Result<(), String> {
    let dir_str = get_diary_dir(app)?;
    let dir_path = PathBuf::from(dir_str);
    
    let file_path = dir_path.join(format!("{}.diary", date));
    let temp_file_path = dir_path.join(format!("{}.diary.tmp", date));
    
    // Never overwrite a diary still encrypted by the old app version:
    // it would be read back as empty and the original would be lost.
    if let Ok(existing) = fs::read(&file_path) {
        if std::str::from_utf8(&existing).is_err() {
            return Err("암호화된 일기는 덮어쓸 수 없습니다. scripts/decrypt_diary.py 로 먼저 암호를 해제해 주세요.".into());
        }
    }

    let data_to_write = content.into_bytes();

    // Write to a temporary file first
    fs::write(&temp_file_path, data_to_write).map_err(|e| format!("Failed to write temporary file: {}", e))?;
    
    // Rename to perform atomic save
    fs::rename(&temp_file_path, &file_path).map_err(|e| {
        // Try to clean up temp file if rename fails
        let _ = fs::remove_file(&temp_file_path);
        format!("Failed to save file atomically: {}", e)
    })?;
    
    Ok(())
}

// 5. Import old diaries
#[tauri::command]
pub fn import_diaries(app: AppHandle, source_dir: String) -> Result<usize, String> {
    let source_path = PathBuf::from(&source_dir);
    if !source_path.exists() || !source_path.is_dir() {
        return Err("Source directory does not exist or is not a directory".into());
    }

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
                        // Save using our existing atomic save logic
                        if save_diary(app.clone(), date_str, content).is_ok() {
                            imported_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(imported_count)
}
