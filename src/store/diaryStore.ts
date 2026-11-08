import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/** One immutable history snapshot of a diary (see src-tauri/src/history.rs). */
export interface SnapshotInfo {
  id: string;
  timestamp_ms: number;
  device: string;
  kind: string;
}

interface DiaryList {
  dates: string[];
  conflicts_imported: string[];
}

interface ReadDiaryResult {
  content: string;
  external_change: boolean;
}

/** Snapshot kinds the frontend asks for. */
export type SnapshotKind = "manual" | "leave" | "periodic";

const AUTOSAVE_DELAY_MS = 1500;
/** While editing, take a "periodic" snapshot at most this often. */
const PERIODIC_SNAPSHOT_MS = 10 * 60 * 1000;

interface DiaryState {
  diaries: string[];        // Array of YYYY-MM-DD strings, newest first
  currentDate: string;      // The currently selected date (YYYY-MM-DD)
  currentContent: string;   // The content of the currently selected diary
  isSaving: boolean;
  /** Edited in the editor but not written to disk yet. */
  isDirty: boolean;
  /** Written to disk since the last snapshot attempt. */
  needsSnapshot: boolean;
  lastSnapshotAt: number;
  /** The diary changed outside the app since it was last recorded. */
  externalChange: boolean;
  /** History of the current diary, newest first. */
  snapshots: SnapshotInfo[];
  /** Dates whose OneDrive conflict copies were moved into history. */
  conflictsImported: string[];
  saveError: string | null;

  fetchDiaries: () => Promise<void>;
  selectDiary: (date: string) => Promise<void>;
  /** Called on every keystroke; schedules the debounced autosave. */
  editContent: (content: string) => void;
  /** Write pending edits now, recording a snapshot of the given kind. */
  flush: (kind: SnapshotKind) => Promise<void>;
  loadSnapshots: () => Promise<void>;
  readSnapshot: (id: string) => Promise<string>;
  restoreSnapshot: (id: string) => Promise<void>;
  dismissExternalChange: () => void;
  dismissConflicts: () => void;
}

// Get today's date in YYYY-MM-DD format
export const getTodayStr = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function clearAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

// Serialize writes so an autosave and a flush never race on the same file.
let writeChain: Promise<void> = Promise.resolve();

export const useDiaryStore = create<DiaryState>((set, get) => {
  /** Write `content` for `date`; snapshot when `kind` is given. */
  const write = (date: string, content: string, kind: SnapshotKind | null) => {
    const run = async () => {
      set({ isSaving: true });
      try {
        const snapshot = await invoke<SnapshotInfo | null>("save_diary", {
          date,
          content,
          snapshot: kind,
        });
        set((state) => {
          if (state.currentDate !== date) return { isSaving: false };
          const stillSame = state.currentContent === content;
          const next: Partial<DiaryState> = {
            isSaving: false,
            saveError: null,
            isDirty: stillSame ? false : state.isDirty,
            needsSnapshot: kind ? false : true,
          };
          if (kind) next.lastSnapshotAt = Date.now();
          if (snapshot) next.snapshots = [snapshot, ...state.snapshots];
          if (!state.diaries.includes(date)) {
            next.diaries = [...state.diaries, date].sort((a, b) => b.localeCompare(a));
          }
          return next;
        });
      } catch (error) {
        console.error(`Failed to save diary for ${date}:`, error);
        set({ isSaving: false, saveError: String(error) });
      }
    };
    writeChain = writeChain.then(run, run);
    return writeChain;
  };

  return {
    diaries: [],
    currentDate: getTodayStr(),
    currentContent: "",
    isSaving: false,
    isDirty: false,
    needsSnapshot: false,
    lastSnapshotAt: Date.now(),
    externalChange: false,
    snapshots: [],
    conflictsImported: [],
    saveError: null,

    fetchDiaries: async () => {
      try {
        const list = await invoke<DiaryList>("list_diaries");
        set({ diaries: list.dates });
        if (list.conflicts_imported.length > 0) {
          set((state) => ({
            conflictsImported: [...new Set([...state.conflictsImported, ...list.conflicts_imported])],
          }));
        }
      } catch (error) {
        console.error("Failed to fetch diaries:", error);
      }
    },

    selectDiary: async (date: string) => {
      // Finish the diary being left so its history is complete before switching.
      await get().flush("leave");
      try {
        const result = await invoke<ReadDiaryResult>("read_diary", { date });
        set({
          currentDate: date,
          currentContent: result.content,
          externalChange: result.external_change,
          isDirty: false,
          needsSnapshot: false,
          lastSnapshotAt: Date.now(),
          saveError: null,
          snapshots: [],
        });
      } catch (error) {
        console.error(`Failed to read diary for ${date}:`, error);
        set({
          currentDate: date,
          currentContent: "",
          externalChange: false,
          isDirty: false,
          needsSnapshot: false,
          saveError: String(error),
          snapshots: [],
        });
      }
      await get().loadSnapshots();
    },

    editContent: (content: string) => {
      set({ currentContent: content, isDirty: true });
      clearAutosave();
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null;
        const { currentDate, currentContent, lastSnapshotAt } = get();
        const due = Date.now() - lastSnapshotAt >= PERIODIC_SNAPSHOT_MS;
        void write(currentDate, currentContent, due ? "periodic" : null);
      }, AUTOSAVE_DELAY_MS);
    },

    flush: async (kind: SnapshotKind) => {
      clearAutosave();
      await writeChain;
      const { currentDate, currentContent, isDirty, needsSnapshot } = get();
      // "manual" always records (deduped by the backend); others only if something changed.
      if (kind === "manual" || isDirty || needsSnapshot) {
        await write(currentDate, currentContent, kind);
      }
    },

    loadSnapshots: async () => {
      const date = get().currentDate;
      try {
        const snapshots = await invoke<SnapshotInfo[]>("list_snapshots", { date });
        if (get().currentDate === date) set({ snapshots });
      } catch (error) {
        console.error(`Failed to list history for ${date}:`, error);
      }
    },

    readSnapshot: (id: string) =>
      invoke<string>("read_snapshot", { date: get().currentDate, id }),

    restoreSnapshot: async (id: string) => {
      await get().flush("leave");
      const date = get().currentDate;
      const content = await invoke<string>("restore_snapshot", { date, id });
      set({
        currentContent: content,
        isDirty: false,
        needsSnapshot: false,
        externalChange: false,
        lastSnapshotAt: Date.now(),
      });
      await get().loadSnapshots();
    },

    dismissExternalChange: () => set({ externalChange: false }),
    dismissConflicts: () => set({ conflictsImported: [] }),
  };
});
