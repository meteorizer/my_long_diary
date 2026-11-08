import { useEffect, useState } from "react";
import { X, RotateCcw, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { useDiaryStore } from "./store/diaryStore";

const KIND_LABELS: Record<string, string> = {
  baseline: "최초 기록",
  manual: "직접 저장",
  periodic: "자동 기록",
  leave: "편집 종료",
  external: "외부 변경",
  restore: "복원",
  backup: "복원 전 백업",
  conflict: "동기화 충돌 사본",
  import: "가져오기",
};

interface HistoryPanelProps {
  onClose: () => void;
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const currentDate = useDiaryStore((state) => state.currentDate);
  const snapshots = useDiaryStore((state) => state.snapshots);
  const loadSnapshots = useDiaryStore((state) => state.loadSnapshots);
  const readSnapshot = useDiaryStore((state) => state.readSnapshot);
  const restoreSnapshot = useDiaryStore((state) => state.restoreSnapshot);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  // Select the newest snapshot by default.
  useEffect(() => {
    if (!selectedId && snapshots.length > 0) setSelectedId(snapshots[0].id);
  }, [snapshots, selectedId]);

  useEffect(() => {
    setConfirming(false);
    if (!selectedId) return;
    let cancelled = false;
    setError(null);
    readSnapshot(selectedId)
      .then((text) => !cancelled && setPreview(text))
      .catch((e) => !cancelled && (setPreview(""), setError(String(e))));
    return () => {
      cancelled = true;
    };
  }, [selectedId, readSnapshot]);

  const handleRestore = async () => {
    if (!selectedId) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setIsRestoring(true);
    try {
      await restoreSnapshot(selectedId);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setIsRestoring(false);
      setConfirming(false);
    }
  };

  const isLatest = snapshots.length > 0 && selectedId === snapshots[0].id;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[90vw] max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{currentDate} 기록</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            아직 기록이 없습니다. 저장하거나 편집을 마치면 기록이 남습니다.
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            <ul className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
              {snapshots.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700/60 transition-colors ${
                      selectedId === s.id
                        ? "bg-blue-50 dark:bg-blue-900/30"
                        : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                      {new Date(s.timestamp_ms).toLocaleString("ko-KR")}
                      {i === 0 && <span className="ml-2 text-xs text-blue-500">최신</span>}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {KIND_LABELS[s.kind] ?? s.kind} · {s.device}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                ) : (
                  <div className="prose dark:prose-invert prose-blue max-w-none">
                    {preview ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{preview}</ReactMarkdown>
                    ) : (
                      <p className="text-gray-400 italic">내용이 없습니다.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end space-x-3">
                {confirming && (
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    현재 내용은 기록에 남고 이 버전으로 바뀝니다.
                  </span>
                )}
                {confirming && (
                  <button
                    onClick={() => setConfirming(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    취소
                  </button>
                )}
                <button
                  onClick={handleRestore}
                  disabled={!selectedId || isLatest || isRestoring || !!error}
                  className="flex items-center px-4 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
                >
                  {isRestoring ? <Loader2 size={16} className="animate-spin mr-2" /> : <RotateCcw size={16} className="mr-2" />}
                  {confirming ? "복원 확인" : "이 버전으로 복원"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
