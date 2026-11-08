import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  diary_directory: string;
  theme: string;
}

interface SettingsState {
  settings: AppSettings;
  isSettingsOpen: boolean;
  
  // Actions
  fetchSettings: () => Promise<void>;
  updateDirectory: (path: string) => Promise<boolean>;
  updateTheme: (theme: string) => Promise<boolean>;
  finalizeSetup: (directory: string) => Promise<boolean>;
  setSettingsOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    diary_directory: "",
    theme: "system",
  },
  isSettingsOpen: false,

  fetchSettings: async () => {
    try {
      const config = await invoke<AppSettings>("get_settings");
      set({ settings: config });
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  },

  updateDirectory: async (newPath: string) => {
    try {
      await invoke("update_diary_directory", { newDirectory: newPath });
      set((state) => ({ 
        settings: { ...state.settings, diary_directory: newPath } 
      }));
      return true;
    } catch (error) {
      console.error("Failed to update directory:", error);
      return false;
    }
  },

  updateTheme: async (theme: string) => {
    try {
      await invoke("update_theme", { theme });
      set((state) => ({ 
        settings: { ...state.settings, theme } 
      }));
      return true;
    } catch (error) {
      console.error("Failed to update theme:", error);
      return false;
    }
  },

  setSettingsOpen: (isOpen: boolean) => set({ isSettingsOpen: isOpen }),

  finalizeSetup: async (directory: string) => {
    try {
      await invoke("finalize_setup", { directory });
      set((state) => ({
        settings: { ...state.settings, diary_directory: directory },
      }));
      return true;
    } catch (error) {
      console.error("Failed to finalize setup:", error);
      return false;
    }
  }
}));
