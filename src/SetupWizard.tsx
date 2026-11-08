import { useState } from "react";
import { FolderOpen, Check, Save } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store/settingsStore";
import { useDiaryStore } from "./store/diaryStore";

interface CheckDirectoryResult {
  is_encrypted: boolean;
}

interface SetupWizardProps {
  onComplete?: () => void;
  onCancel?: () => void;
  isChangeMode?: boolean;
}

export function SetupWizard({ onComplete, onCancel, isChangeMode = false }: SetupWizardProps) {
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { finalizeSetup } = useSettingsStore();

  const handleSelectFolder = async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
      });

      if (selectedPath && typeof selectedPath === 'string') {
        setSelectedFolder(selectedPath);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleCompleteSetup = async () => {
    if (!selectedFolder) {
      setError("Please select a folder first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result: CheckDirectoryResult = await invoke("check_directory", { directory: selectedFolder });
      if (result.is_encrypted) {
        setError(
          "이 폴더에는 암호화된 일기가 남아 있습니다. 먼저 `uv run scripts/decrypt_diary.py <폴더> --apply` 로 암호를 해제해 주세요."
        );
        return;
      }

      const success = await finalizeSetup(selectedFolder);
      if (success) {
        useDiaryStore.getState().fetchDiaries();
        if (onComplete) onComplete();
      } else {
        setError("Failed to save settings.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col mt-[-5vh]">
        <div className="bg-blue-500 text-white px-6 py-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            {isChangeMode ? "Change Storage Location" : "Welcome to My Long Diary"}
          </h2>
          <p className="text-blue-100 text-sm">
            Pick a place to store your diaries.
          </p>
        </div>

        <div className="p-8 space-y-6">
          {error && (
             <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
                {error}
             </div>
          )}

          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="w-20 h-20 bg-blue-50 dark:bg-gray-700 rounded-full flex items-center justify-center border-4 border-white dark:border-gray-800 shadow-sm relative">
                   <FolderOpen size={36} className="text-blue-500 dark:text-blue-400" />
                   <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 border-2 border-white dark:border-gray-800">
                     <Check size={12} className="text-white" />
                   </div>
                </div>
                
                <p className="text-center text-gray-600 dark:text-gray-300 text-sm">
                   Select an empty folder for a new diary, or an existing diary folder to restore it. 
                   <br/>All your precious thoughts will be kept here!
                </p>
              </div>

              <div className="flex space-x-2">
                <input
                  type="text"
                  readOnly
                  placeholder="Click 'Browse' to select a folder..."
                  value={selectedFolder}
                  className="flex-1 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleSelectFolder}
                  className="px-5 py-3 bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Browse
                </button>
              </div>

              <div className="flex justify-end pt-4 space-x-3">
                 {isChangeMode && onCancel && (
                    <button 
                       onClick={onCancel}
                       className="px-6 py-2.5 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                       Cancel
                    </button>
                 )}
                 <button
                    onClick={handleCompleteSetup}
                    disabled={!selectedFolder || isLoading}
                    className="flex items-center px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition-colors"
                 >
                    Finish Setup <Save size={18} className="ml-2" />
                 </button>
              </div>
            </div>

        </div>
      </div>
    </div>
  );
}
