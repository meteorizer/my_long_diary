pub mod commands;
pub mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_diary_dir,
            commands::check_directory,
            commands::list_diaries,
            commands::read_diary,
            commands::save_diary,
            commands::import_diaries,
            settings::get_settings,
            settings::update_diary_directory,
            settings::update_theme,
            settings::finalize_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
