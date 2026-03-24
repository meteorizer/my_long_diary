import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  diary_directory: string;
  has_password: boolean;
  password_salt: string | null;
  theme: string;
}

interface SettingsState {
  settings: AppSettings;
  sessionKey: string | null; // Keep the plain password in memory once unlocked
  isSettingsOpen: boolean;
  
  // Actions
  fetchSettings: () => Promise<void>;
  updateDirectory: (path: string) => Promise<boolean>;
  updatePassword: (hasPassword: boolean, salt: string | null) => Promise<boolean>;
  updateTheme: (theme: string) => Promise<boolean>;
  finalizeSetup: (directory: string, hasPassword: boolean, salt: string | null, passwordKey?: string) => Promise<boolean>;
  setSessionKey: (key: string | null) => void;
  setSettingsOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    diary_directory: "",
    has_password: false,
    password_salt: null,
    theme: "system",
  },
  sessionKey: null,
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

  updatePassword: async (hasPassword: boolean, salt: string | null) => {
    try {
      await invoke("update_password_settings", { hasPassword, salt });
      set((state) => ({ 
        settings: { ...state.settings, has_password: hasPassword, password_salt: salt } 
      }));
      return true;
    } catch (error) {
      console.error("Failed to update password settings:", error);
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

  setSessionKey: (key: string | null) => set({ sessionKey: key }),
  setSettingsOpen: (isOpen: boolean) => set({ isSettingsOpen: isOpen }),

  finalizeSetup: async (directory: string, hasPassword: boolean, salt: string | null, passwordKey?: string) => {
    try {
      await invoke("finalize_setup", { directory, hasPassword, salt });
      set((state) => ({ 
        settings: { 
          ...state.settings, 
          diary_directory: directory,
          has_password: hasPassword,
          password_salt: salt
        },
        sessionKey: passwordKey || null
      }));
      return true;
    } catch (error) {
      console.error("Failed to finalize setup:", error);
      return false;
    }
  }
}));
