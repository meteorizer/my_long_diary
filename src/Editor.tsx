import { useState, useEffect, useRef } from "react";
import { Save, X, Loader2, Edit3, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useDiaryStore, getTodayStr } from "./store/diaryStore";

interface EditorProps {
  onClose: () => void;
}

export function Editor({ onClose }: EditorProps) {
  const currentDate = useDiaryStore((state) => state.currentDate);
  const currentContent = useDiaryStore((state) => state.currentContent);
  const isSaving = useDiaryStore((state) => state.isSaving);
  const setCurrentContent = useDiaryStore((state) => state.setCurrentContent);
  const saveDiary = useDiaryStore((state) => state.saveDiary);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const isReadOnly = currentDate < getTodayStr();
  const [viewMode, setViewMode] = useState<"edit" | "view">(isReadOnly ? "view" : "edit");

  useEffect(() => {
    if (isReadOnly) {
      setViewMode("view");
    }
  }, [currentDate, isReadOnly]);

  // Format date for display
  const displayDate = new Date(currentDate).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setCurrentContent(newContent);

    // Debounce save (e.g., 1.5 seconds)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      saveDiary(currentDate, newContent);
    }, 1500);
  };

  const handleManualSave = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    saveDiary(currentDate, currentContent);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full flex flex-col w-full bg-white dark:bg-[var(--bg-primary)] shadow-[-10px_0_15px_-3px_rgba(0,0,0,0.05)] z-10">
      <div className="flex-1 flex flex-col mx-auto w-full max-w-[960px] min-w-[960px] px-8 pt-8 pb-[4.5rem] lg:px-12 lg:pt-12 lg:pb-[4.5rem] overflow-x-hidden overflow-y-auto">
        <div className="mb-4 flex items-end justify-between border-b border-gray-200 dark:border-gray-800 pb-4">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-800 dark:text-gray-100 mb-3 tracking-tight">
              {displayDate.includes('Invalid') ? currentDate : displayDate}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm flex items-center">
              {isSaving ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-2 text-blue-500" />
                  <span className="text-blue-500">저장 중...</span>
                </>
              ) : (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                  모든 변경사항 저장됨
                </>
              )}
            </p>
          </div>
          
          <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            {!isReadOnly ? (
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
              <div className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-500 bg-gray-200 dark:bg-gray-700 rounded-md">
                <Eye size={16} className="mr-1.5" />
                읽기 전용 (Read Only)
              </div>
            )}
          </div>
        </div>

        {viewMode === "edit" ? (
          <textarea
            autoFocus
            className="flex-1 w-full bg-transparent resize-none outline-none text-lg text-gray-700 dark:text-gray-200 leading-relaxed placeholder-gray-300 dark:placeholder-gray-600 font-sans"
            placeholder="오늘 하루는 어땠나요?"
            value={currentContent}
            onChange={handleChange}
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
          onClick={onClose}
          className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 rounded-lg transition-colors shadow-sm"
        >
          <X size={16} className="mr-2 opacity-70" />
          닫기
        </button>
        {!isReadOnly && (
          <button 
            onClick={handleManualSave}
            disabled={isSaving}
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
