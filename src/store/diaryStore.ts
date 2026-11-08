import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
interface DiaryState {
  diaries: String[];        // Array of YYYY-MM-DD strings
  currentDate: string;      // The currently selected date (YYYY-MM-DD or similar format)
  currentContent: string;   // The content of the currently selected diary
  isSaving: boolean;        // Saving state

  // Actions
  fetchDiaries: () => Promise<void>;
  selectDiary: (date: string) => Promise<void>;
  setCurrentContent: (content: string) => void;
  saveDiary: (date: string, content: string) => Promise<void>;
}

// Get today's date in YYYY-MM-DD format
export const getTodayStr = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

export const useDiaryStore = create<DiaryState>((set) => ({
  diaries: [],
  currentDate: getTodayStr(),
  currentContent: "",
  isSaving: false,

  fetchDiaries: async () => {
    try {
      const diaries: String[] = await invoke("list_diaries");
      set({ diaries });
    } catch (error) {
      console.error("Failed to fetch diaries:", error);
    }
  },

  selectDiary: async (date: string) => {
    try {
      const content: string = await invoke("read_diary", { date });
      set({ currentDate: date, currentContent: content });
    } catch (error) {
      console.error(`Failed to read diary for ${date}:`, error);
      // Even if failed, we select it, it just might be a new file
      set({ currentDate: date, currentContent: "" });
    }
  },

  setCurrentContent: (content: string) => {
    set({ currentContent: content });
  },

  saveDiary: async (date: string, content: string) => {
    set({ isSaving: true });
    try {
      await invoke("save_diary", { date, content });
      
      // Update the local list to include this date if it's new
      set((state) => {
        if (!state.diaries.includes(date)) {
          // Add and keep it sorted descending
          const newDiaries = [...state.diaries, date].sort((a, b) => 
            String(b).localeCompare(String(a))
          );
          return { diaries: newDiaries, isSaving: false };
        }
        return { isSaving: false };
      });
      
    } catch (error) {
      console.error(`Failed to save diary for ${date}:`, error);
      set({ isSaving: false });
    }
  },
}));
