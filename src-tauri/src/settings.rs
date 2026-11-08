use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub diary_directory: String,
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        let docs_dir = directories::UserDirs::new()
            .and_then(|dirs| dirs.document_dir().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
            
        let default_dir = docs_dir.join("My Long Diary").to_string_lossy().to_string();

        AppSettings {
            diary_directory: "".to_string(), // Empty by default to trigger Setup Wizard
            theme: "system".to_string(),
        }
    }
}

pub fn get_settings_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
    // Ensure dir exists
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path.push("settings.json");
    path
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    let path = get_settings_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path(app);
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn update_diary_directory(app: AppHandle, new_directory: String) -> Result<(), String> {
    let mut settings = load_settings(&app);
    
    // Check if new directory exists and is valid
    let path = PathBuf::from(&new_directory);
    if !path.exists() {
        let _ = fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    
    settings.diary_directory = new_directory;
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn update_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let mut settings = load_settings(&app);
    settings.theme = theme;
    save_settings(&app, &settings)
}

#[tauri::command]
pub fn finalize_setup(
    app: AppHandle,
    directory: String,
) -> Result<(), String> {
    let mut settings = load_settings(&app);
    
    // Ensure dir exists
    let path = PathBuf::from(&directory);
    if !path.exists() {
        let _ = fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    
    settings.diary_directory = directory;

    save_settings(&app, &settings)
}
