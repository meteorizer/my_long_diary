import { useState, useEffect } from "react";
import { Lock, Loader2, ArrowRight } from "lucide-react";
import { useSettingsStore } from "./store/settingsStore";
import { invoke } from "@tauri-apps/api/core";

export function LockScreen() {
  const { fetchSettings, setSessionKey } = useSettingsStore();
  const [password, setPassword] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    
    setIsVerifying(true);
    setError(null);
    
    try {
      const isValid = await invoke<boolean>("verify_password", { password });
      if (isValid) {
        setSessionKey(password);
      } else {
        setError("기존 비밀번호가 일치하지 않습니다. (Incorrect password)");
        setPassword("");
      }
    } catch (err) {
      setError(String(err) || "Failed to verify password");
      setPassword("");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg-primary)] flex flex-col items-center justify-center">
      <div className="max-w-md w-full px-8 py-10 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/40 rounded-full flex items-center justify-center mb-6 text-blue-500">
          <Lock size={32} />
        </div>
        
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          My Long Diary 잠겨있음
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">
          저장된 일기를 보려면 암호를 입력해 주세요.
        </p>

        <form onSubmit={handleSubmit} className="w-full relative">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isVerifying}
            className="w-full pl-5 pr-14 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-xl text-lg text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm"
            placeholder="비밀번호 입력"
          />
          <button
            type="submit"
            disabled={isVerifying || !password}
            className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:dark:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
          >
            {isVerifying ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-red-500 font-medium animate-pulse">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
