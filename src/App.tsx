import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Editor } from "./Editor";
import { Settings } from "./Settings";
import { SetupWizard } from "./SetupWizard";
import { Book, Menu } from "lucide-react";
import { useDiaryStore, getTodayStr } from "./store/diaryStore";
import { useSettingsStore } from "./store/settingsStore";
import { getCurrentWindow } from "@tauri-apps/api/window";

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  
  // Settings Store
  const { settings, isSettingsOpen, fetchSettings } = useSettingsStore();

  const needsSetup = !settings.diary_directory || settings.diary_directory.trim() === "";
  
  // Zustand Store
  const fetchDiaries = useDiaryStore((state) => state.fetchDiaries);
  const selectDiary = useDiaryStore((state) => state.selectDiary);

  // Load diaries and settings on startup
  useEffect(() => {
    fetchSettings();
    if (!needsSetup) {
      fetchDiaries();
    }
  }, [fetchSettings, fetchDiaries, needsSetup]);

  // Record the open diary in history before the window closes.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      try {
        await useDiaryStore.getState().flush("leave");
      } catch (e) {
        console.error("Failed to save before closing:", e);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const conflictsImported = useDiaryStore((state) => state.conflictsImported);
  const dismissConflicts = useDiaryStore((state) => state.dismissConflicts);

  // Handle Theme application
  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isSystemDark = mediaQuery.matches;
      if (settings.theme === 'dark' || (settings.theme === 'system' && isSystemDark)) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme();

    // Listen for system theme changes if using "system" theme
    const handler = () => {
      if (settings.theme === 'system') {
        applyTheme();
      }
    };
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [settings.theme]);

  const handleNewDiary = async () => {
    const today = getTodayStr();
    await selectDiary(today);
    setIsEditorOpen(true);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] relative">
      {needsSetup && <SetupWizard />}
      {!needsSetup && isSettingsOpen && <Settings />}
      <Sidebar 
        isOpen={isSidebarOpen} 
        setIsOpen={setIsSidebarOpen} 
        onSelectDiary={(date) => {
          selectDiary(date);
          setIsEditorOpen(true);
        }}
      />

      <main
        className={`relative flex-1 flex flex-col h-full bg-[var(--bg-primary)] transition-all duration-300 ease-in-out ${
          isSidebarOpen ? "ml-72" : "ml-0"
        }`}
      >
        {conflictsImported.length > 0 && (
          <div className="absolute top-4 right-4 z-50 max-w-md px-4 py-3 text-sm rounded-lg shadow-md bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800 flex items-start">
            <span>
              OneDrive 동기화 충돌 사본을 기록으로 옮겼어요: {conflictsImported.join(", ")}.
              해당 날짜의 "기록"에서 내용을 확인하고 필요하면 복원하세요.
            </span>
            <button onClick={dismissConflicts} className="ml-3 opacity-60 hover:opacity-100 font-bold">
              ×
            </button>
          </div>
        )}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-4 left-4 p-2 bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 z-50 transition-colors"
            aria-label="Open Sidebar"
          >
            <Menu size={20} />
          </button>
        )}

        <div className="flex-1 overflow-hidden flex flex-col items-center justify-center relative bg-gray-50 dark:bg-gray-900">
          {isEditorOpen ? (
            <Editor onClose={() => setIsEditorOpen(false)} />
          ) : (
            <div className="flex-1 flex flex-col w-full items-center justify-center text-gray-400">
              <div className="w-32 h-32 mb-6 rounded-2xl bg-gradient-to-tr from-blue-100 to-indigo-50 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center shadow-sm border border-gray-100 dark:border-gray-700">
                <Book size={48} className="text-blue-500 dark:text-blue-400 opacity-80" />
              </div>
              <h2 className="text-xl font-medium text-gray-600 dark:text-gray-300 mb-2 font-sans tracking-tight">My Long Diary</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-sm text-center">
                Select a diary from the sidebar to continue reading, or write a new entry.
              </p>
              
              <button 
                onClick={handleNewDiary}
                className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg shadow-sm transition-colors"
              >
                새 일기 작성하기
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Add state import that was previously missing (fix vite error implicitly)
import { useState } from 'react';
export default App;
