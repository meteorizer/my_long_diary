import { useState, useEffect } from "react";
import { Save, X, Loader2, Edit3, Eye, History, Pencil, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useDiaryStore, getTodayStr, SnapshotInfo } from "./store/diaryStore";
import { HistoryPanel } from "./HistoryPanel";

interface EditorProps {
  onClose: () => void;
}

/** Snapshot kinds that mean the text was actually changed (not just recorded). */
const EDIT_KINDS = new Set(["manual", "periodic", "leave", "external", "restore", "import"]);

function localDateStr(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A past diary counts as edited when it has an edit recorded after its own day. */
function editedAfterTheDay(date: string, snapshots: SnapshotInfo[]) {
  return snapshots.some((s) => EDIT_KINDS.has(s.kind) && localDateStr(s.timestamp_ms) > date);
}

export function Editor({ onClose }: EditorProps) {
  const currentDate = useDiaryStore((state) => state.currentDate);
  const currentContent = useDiaryStore((state) => state.currentContent);
  const isSaving = useDiaryStore((state) => state.isSaving);
  const isDirty = useDiaryStore((state) => state.isDirty);
  const externalChange = useDiaryStore((state) => state.externalChange);
  const saveError = useDiaryStore((state) => state.saveError);
  const snapshots = useDiaryStore((state) => state.snapshots);
  const editContent = useDiaryStore((state) => state.editContent);
  const flush = useDiaryStore((state) => state.flush);
  const dismissExternalChange = useDiaryStore((state) => state.dismissExternalChange);

  const isPast = currentDate < getTodayStr();
  const [editUnlocked, setEditUnlocked] = useState(false);
  const canEdit = !isPast || editUnlocked;
  const [viewMode, setViewMode] = useState<"edit" | "view">(isPast ? "view" : "edit");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Each diary opens locked (if past) and in its default mode.
  useEffect(() => {
    setEditUnlocked(false);
    setViewMode(currentDate < getTodayStr() ? "view" : "edit");
  }, [currentDate]);

  // Ctrl+S / Cmd+S saves and records a snapshot.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit) void flush("manual");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, flush]);

  // Format date for display
  const displayDate = new Date(currentDate).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const handleUnlock = () => {
    setEditUnlocked(true);
    setViewMode("edit");
  };

  const handleClose = async () => {
    await flush("leave");
    onClose();
  };

  const wasEdited = isPast && editedAfterTheDay(currentDate, snapshots);

  return (
    <div className="h-full flex flex-col w-full bg-white dark:bg-[var(--bg-primary)] shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)] z-10">
      {isHistoryOpen && <HistoryPanel onClose={() => setIsHistoryOpen(false)} />}
      <div className="flex-1 flex flex-col mx-auto w-full max-w-[960px] min-w-[960px] px-8 pt-8 pb-[4.5rem] lg:px-12 lg:pt-12 lg:pb-[4.5rem] overflow-x-hidden overflow-y-auto">
        <div className="mb-4 flex items-end justify-between border-b border-gray-200 dark:border-gray-800 pb-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-800 dark:text-gray-100 mb-3 tracking-tight flex items-center">
              {displayDate.includes('Invalid') ? currentDate : displayDate}
              {wasEdited && (
                <button
                  onClick={() => setIsHistoryOpen(true)}
                  className="ml-3 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                  title="그날 이후 수정된 기록이 있습니다"
                >
                  수정됨
                </button>
              )}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm flex items-center">
              {isSaving ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-2 text-blue-500" />
                  <span className="text-blue-500">저장 중...</span>
                </>
              ) : isDirty ? (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-2"></span>
                  저장 대기 중
                </>
              ) : (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                  모든 변경사항 저장됨
                </>
              )}
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center px-3 py-1.5 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <History size={16} className="mr-1.5" />
              기록{snapshots.length > 0 ? ` ${snapshots.length}` : ""}
            </button>

            <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
              {canEdit ? (
                <>
                  <button
                    onClick={() => setViewMode("edit")}
                    className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      viewMode === "edit"
                        ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    <Edit3 size={16} className="mr-1.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => setViewMode("view")}
                    className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      viewMode === "view"
                        ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    }`}
                  >
                    <Eye size={16} className="mr-1.5" />
                    Preview
                  </button>
                </>
              ) : (
                <button
                  onClick={handleUnlock}
                  className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-md hover:bg-white dark:hover:bg-gray-700 transition-colors"
                  title="지난 일기를 수정합니다. 수정 내용은 기록에 남습니다."
                >
                  <Pencil size={16} className="mr-1.5" />
                  편집
                </button>
              )}
            </div>
          </div>
        </div>

        {isPast && editUnlocked && (
          <div className="mb-4 px-4 py-2 text-sm rounded-lg bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800">
            지난 일기를 편집하고 있어요. 수정 내용은 기록에 남습니다.
          </div>
        )}

        {externalChange && (
          <div className="mb-4 px-4 py-2 text-sm rounded-lg bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800 flex items-center justify-between">
            <span>
              마지막 기록 이후 앱 밖에서 바뀐 내용이 있어 기록에 남겼어요. 이전 내용은{" "}
              <button onClick={() => setIsHistoryOpen(true)} className="underline font-medium">
                기록
              </button>
              에서 볼 수 있어요.
            </span>
            <button onClick={dismissExternalChange} className="ml-3 opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        )}

        {saveError && (
          <div className="mb-4 px-4 py-2 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800 flex items-center">
            <AlertTriangle size={16} className="mr-2 shrink-0" />
            {saveError}
          </div>
        )}

        {viewMode === "edit" && canEdit ? (
          <textarea
            autoFocus
            className="flex-1 w-full bg-transparent resize-none outline-none text-lg text-gray-700 dark:text-gray-200 leading-relaxed placeholder-gray-300 dark:placeholder-gray-600 font-sans"
            placeholder="오늘 하루는 어땠나요?"
            value={currentContent}
            onChange={(e) => editContent(e.target.value)}
          />
        ) : (
          <div className="flex-1 w-full prose prose-lg dark:prose-invert prose-blue max-w-none prose-headings:font-bold prose-a:text-blue-500 hover:prose-a:text-blue-600">
            {currentContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {currentContent}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-400 italic">내용이 없습니다.</p>
            )}
          </div>
        )}
      </div>

      {/* Footer / Actions */}
      <div className="px-6 py-4 border-t border-[var(--border-color)] flex justify-end space-x-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md absolute bottom-0 w-full left-0 z-20 transition-colors">
        <button
          onClick={handleClose}
          className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 rounded-lg transition-colors shadow-sm"
        >
          <X size={16} className="mr-2 opacity-70" />
          닫기
        </button>
        {canEdit && (
          <button
            onClick={() => flush("manual")}
            disabled={isSaving}
            title="저장하고 기록에 남깁니다 (Ctrl+S)"
            className={`flex items-center px-5 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors ${
              isSaving ? "bg-indigo-400 cursor-not-allowed" : "bg-indigo-500 hover:bg-indigo-600"
            }`}
          >
            {isSaving ? (
              <Loader2 size={16} className="animate-spin mr-2" />
            ) : (
              <Save size={16} className="mr-2" />
            )}
            {isSaving ? "저장 중" : "저장"}
          </button>
        )}
      </div>
    </div>
  );
}
