import { useState, useEffect } from "react";
import { FolderOpen, Lock, X, Save, Monitor } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "./store/settingsStore";
import { useDiaryStore } from "./store/diaryStore";
import { invoke } from "@tauri-apps/api/core";
import { SetupWizard } from "./SetupWizard";

export function Settings() {
  const { settings, fetchSettings, updatePassword, updateTheme, setSettingsOpen } = useSettingsStore();
  
  const [localDir, setLocalDir] = useState(settings.diary_directory);
  const [isPasswordEnabled, setIsPasswordEnabled] = useState(settings.has_password);
  const [localTheme, setLocalTheme] = useState(settings.theme);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  const [showSetupMode, setShowSetupMode] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setLocalDir(settings.diary_directory);
    setIsPasswordEnabled(settings.has_password);
    setLocalTheme(settings.theme);
  }, [settings]);

  const handleChangeFolder = () => {
    setShowSetupMode(true);
  };

  const handleSetupComplete = () => {
    setShowSetupMode(false);
    // Reload local settings from the store to update UI
    const updatedState = useSettingsStore.getState().settings;
    setLocalDir(updatedState.diary_directory);
    setIsPasswordEnabled(updatedState.has_password);
    setSuccess("Directory updated successfully.");
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    setError(null);
    setSuccess(null);

    // Save theme changes
    if (localTheme !== settings.theme) {
      const themeSuccess = await updateTheme(localTheme);
      if (!themeSuccess) {
        setError("Failed to update theme");
        return;
      }
    }

    // Save password changes
    if (isPasswordEnabled && newPassword) {
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      // We should ideally generate a salt and hash locally or via rust command.
      // But we haven't exposed generic `generate_salt` in commands.rs yet...
      // Wait, we need to generate salt somewhere. Let's just generate a basic random string for salt here, 
      // or we can add a rust command `generate_salt()`. 
      // For now, let's generate a simple UUID-based salt in Javascript.
      const newSalt = crypto.randomUUID().replace(/-/g, '');
      
      const pwdSuccess = await updatePassword(true, newSalt);
      if (!pwdSuccess) {
        setError("Failed to set password");
        return;
      }
      
      // Update session key in memory so we don't immediately lock them out
      useSettingsStore.getState().setSessionKey(newPassword);
      setNewPassword("");
      setConfirmPassword("");
    } else if (!isPasswordEnabled && settings.has_password) {
      // Removing password
      const pwdSuccess = await updatePassword(false, null);
      if (!pwdSuccess) {
        setError("Failed to remove password");
        return;
      }
      useSettingsStore.getState().setSessionKey(null);
    }

    setSuccess("Settings saved successfully");
    setTimeout(() => {
      setSettingsOpen(false);
    }, 1500);
  };

  const handleImportDiaries = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
      });

      if (selectedPath && typeof selectedPath === 'string') {
        setIsImporting(true);
        setError(null);
        setSuccess(null);
        
        const password = useSettingsStore.getState().sessionKey;
        const importedCount = await invoke<number>("import_diaries", { 
          sourceDir: selectedPath,
          password
        });
        
        setSuccess(`Successfully imported ${importedCount} diaries.`);
        
        // Refresh the diary list in the main app
        useDiaryStore.getState().fetchDiaries();
      }
    } catch (err) {
      setError(String(err) || "Failed to import diaries");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      {showSetupMode && (
        <SetupWizard 
           isChangeMode={true} 
           onComplete={handleSetupComplete} 
           onCancel={() => setShowSetupMode(false)}
        />
      )}
      <div className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center ${showSetupMode ? 'hidden' : ''}`}>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center">
              Settings
            </h2>
          <button 
            onClick={() => setSettingsOpen(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 text-sm text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg">
              {success}
            </div>
          )}

          {/* Directory Settings */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide flex items-center">
              <FolderOpen size={16} className="mr-2" /> Storage Location
            </h3>
            <div className="flex space-x-2">
              <input
                type="text"
                readOnly
                value={localDir}
                className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 outline-none"
              />
              <button
                onClick={handleChangeFolder}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                Change
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Where your diary files (.diary) are saved on your computer.
            </p>
          </div>

          {/* Display Settings */}
          <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide flex items-center">
              <Monitor size={16} className="mr-2" /> Display Theme
            </h3>
            <div className="flex space-x-3 mt-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <label key={t} className="flex-1">
                  <input
                    type="radio"
                    name="theme"
                    value={t}
                    checked={localTheme === t}
                    onChange={(e) => setLocalTheme(e.target.value)}
                    className="sr-only peer"
                  />
                  <div className="text-center px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 cursor-pointer peer-checked:bg-blue-50 dark:peer-checked:bg-blue-900/30 peer-checked:text-blue-600 dark:peer-checked:text-blue-400 peer-checked:border-blue-500 transition-all hover:bg-gray-50 dark:hover:bg-gray-700">
                    {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Import Old Diaries */}
          <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide flex items-center">
              <FolderOpen size={16} className="mr-2" /> Backup & Restore
            </h3>
            
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Import Old Diaries</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Merge existing .txt or .md files (YYYY-MM-DD or YYYYMMDD format) into your current diary directory.
                </p>
              </div>
              <button
                onClick={handleImportDiaries}
                disabled={isImporting}
                className="ml-4 px-4 py-2 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isImporting ? "Importing..." : "Import"}
              </button>
            </div>
          </div>

          {/* Security Settings */}
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide flex items-center">
                <Lock size={16} className="mr-2" /> App Security
              </h3>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={isPasswordEnabled}
                  onChange={(e) => setIsPasswordEnabled(e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
              </label>
            </div>
            
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              If enabled, diaries are encrypted using AES-256-GCM. 
              <br/><span className="text-orange-500 dark:text-orange-400 font-medium">Warning: If you lose your password, your diaries cannot be recovered.</span>
            </p>

            {isPasswordEnabled && (
              <div className="space-y-3 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={settings.has_password ? "Leave blank to keep existing" : "Enter new password"}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                {newPassword.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end space-x-3">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center px-5 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg shadow-sm transition-colors"
          >
            <Save size={16} className="mr-2" />
            Save Changes
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
