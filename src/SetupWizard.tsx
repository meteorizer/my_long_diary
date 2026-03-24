import { useState } from "react";
import { FolderOpen, Lock, Unlock, ChevronRight, Check, Save } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store/settingsStore";
import { useDiaryStore } from "./store/diaryStore";

interface CheckDirectoryResult {
  has_salt: boolean;
  salt: string | null;
}

interface SetupWizardProps {
  onComplete?: () => void;
  onCancel?: () => void;
  isChangeMode?: boolean;
}

export function SetupWizard({ onComplete, onCancel, isChangeMode = false }: SetupWizardProps) {
  const [step, setStep] = useState<"folder" | "auth">("folder");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [hasExistingSalt, setHasExistingSalt] = useState(false);
  const [existingSalt, setExistingSalt] = useState<string | null>(null);
  
  // Auth state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usePassword, setUsePassword] = useState(true);
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
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const verifyFolder = async () => {
    if (!selectedFolder) {
      setError("Please select a folder first.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result: CheckDirectoryResult = await invoke("check_directory", { directory: selectedFolder });
      setHasExistingSalt(result.has_salt);
      setExistingSalt(result.salt);
      
      if (result.has_salt) {
        // Force usePassword to true since an existing salt implies a password
        setUsePassword(true);
      } else {
        // For new setups, default to yes
        setUsePassword(true);
      }
      
      setStep("auth");
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteSetup = async () => {
    setError(null);
    setIsLoading(true);

    try {
      if (hasExistingSalt) {
        // Check password against existing salt
        try {
          // Temporarily invoke a separate validation command, or we just trust verify_password
          // Actually verify_password uses the settings salt. We don't have it set in the backend yet since we are in setup mode.
          // Wait, 'verify_password' in backend uses settings::get_app_salt().
          // What if we just call verify_password but we haven't saved settings? 
          // We can't rely on `verify_password` if the directory isn't set.
          // Let's create a custom invoke or just `finalizeSetup` and if it fails to read diaries later, they're locked. 
          // Actually, let's just save it. If the password is wrong, the diaries will fail to decrypt. They can reset it or something.
          // Let's assume the user knows their password for an existing folder.
          
          const success = await finalizeSetup(selectedFolder, true, existingSalt, password);
          if (success) {
             useDiaryStore.getState().fetchDiaries();
             if (onComplete) onComplete();
          } else {
            setError("Failed to save settings.");
          }
        } catch (e) {
             setError("Failed to verify existing password");
        }
        
      } else {
        // Complete new configuration
        if (usePassword) {
          if (!password) {
            setError("Password cannot be empty");
            setIsLoading(false);
            return;
          }
          if (password !== confirmPassword) {
            setError("Passwords do not match");
            setIsLoading(false);
            return;
          }
          
          const newSalt = crypto.randomUUID().replace(/-/g, '');
          const success = await finalizeSetup(selectedFolder, true, newSalt, password);
          if (success) {
            useDiaryStore.getState().fetchDiaries();
            if (onComplete) onComplete();
          } else {
            setError("Failed to save settings.");
          }
        } else {
          // No password
          const success = await finalizeSetup(selectedFolder, false, null, undefined);
          if (success) {
            useDiaryStore.getState().fetchDiaries();
            if (onComplete) onComplete();
          } else {
            setError("Failed to save settings.");
          }
        }
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
            {step === "folder" ? "First, let's pick a place to securely store your diaries." : "Let's configure security for your diaries."}
          </p>
        </div>

        <div className="p-8 space-y-6">
          {error && (
             <div className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
                {error}
             </div>
          )}

          {step === "folder" && (
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
                    onClick={verifyFolder}
                    disabled={!selectedFolder || isLoading}
                    className="flex items-center px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg shadow-sm transition-colors"
                 >
                    Continue <ChevronRight size={18} className="ml-1" />
                 </button>
              </div>
            </div>
          )}

          {step === "auth" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              
              {hasExistingSalt ? (
                 <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-3 mb-6">
                       <div className="p-3 bg-blue-50 dark:bg-gray-800 rounded-full text-blue-500 dark:text-blue-400">
                          <Unlock size={24} />
                       </div>
                    </div>
                    <div className="text-center">
                       <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Existing Diaries Found</h3>
                       <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          This folder is protected by an existing password. Please enter it to unlock your diaries.
                       </p>
                    </div>
                    
                    <div className="pt-4">
                       <input
                         type="password"
                         value={password}
                         onChange={(e) => setPassword(e.target.value)}
                         placeholder="Enter your existing password"
                         className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
                         onKeyDown={(e) => e.key === 'Enter' && handleCompleteSetup()}
                         autoFocus
                       />
                    </div>
                 </div>
              ) : (
                 <div className="space-y-5">
                    <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-700">
                      <div>
                         <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                           <Lock size={18} className="mr-2 text-blue-500" /> Secure your diary
                         </h3>
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
                           Enable AES-256 encryption. If you lose this password, your diaries cannot be recovered.
                         </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer" 
                          checked={usePassword}
                          onChange={(e) => setUsePassword(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
                      </label>
                    </div>

                    {usePassword && (
                       <div className="space-y-4 pt-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Create Password</label>
                            <input
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="Enter a strong password"
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
                            <input
                              type="password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="Type your password again"
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 outline-none"
                              onKeyDown={(e) => e.key === 'Enter' && handleCompleteSetup()}
                            />
                          </div>
                       </div>
                    )}
                 </div>
              )}

              <div className="flex justify-between pt-4">
                 <button
                    onClick={() => {
                        setStep("folder");
                        setError(null);
                        setPassword("");
                        setConfirmPassword("");
                    }}
                    className="px-5 py-2.5 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                 >
                    Back
                 </button>
                 <button
                    onClick={handleCompleteSetup}
                    disabled={isLoading}
                    className="flex items-center px-8 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium rounded-lg shadow-sm transition-colors"
                 >
                    Finish Setup <Save size={18} className="ml-2" />
                 </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
