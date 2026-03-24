import { Dispatch, SetStateAction, useState } from "react";
import { Settings, Search, X, Calendar as CalendarIcon } from "lucide-react";
import { useDiaryStore } from "./store/diaryStore";
import { useSettingsStore } from "./store/settingsStore";

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  onSelectDiary?: (date: string) => void;
}

export function Sidebar({ isOpen, setIsOpen, onSelectDiary }: SidebarProps) {
  const diaries = useDiaryStore((state) => state.diaries);
  const currentDate = useDiaryStore((state) => state.currentDate);
  const setSettingsOpen = useSettingsStore((state) => state.setSettingsOpen);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredDiaries = searchQuery.trim()
    ? diaries.filter((date) => date.includes(searchQuery.trim()))
    : diaries;

  // Group diaries by Year/Month
  const groupedDiaries = filteredDiaries.reduce((acc: Record<string, string[]>, date: String) => {
    const dateStr = date as string;
    const [year, month] = dateStr.split("-");
    const key = `${year}년 ${parseInt(month)}월`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(dateStr);
    return acc;
  }, {});

  return (
    <>
      <div
        className={`fixed inset-y-0 left-0 bg-[var(--bg-secondary)] border-r border-[var(--border-color)] w-72 transform transition-transform duration-300 ease-in-out z-20 flex flex-col shadow-sm ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] bg-white dark:bg-gray-800">
          <h2 className="font-bold text-xl text-gray-800 dark:text-gray-200 tracking-tight">
            My Long Diary
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-500 dark:text-gray-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-[var(--border-color)] bg-gray-50 dark:bg-gray-800/50">


          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <Search size={16} className="text-gray-400" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search diaries..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-800 border border-[var(--border-color)] rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm placeholder-gray-400 transition-shadow"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800 p-2 space-y-4">
          {Object.entries(groupedDiaries).length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              아직 작성된 일기가 없습니다.
            </div>
          ) : (
            Object.entries(groupedDiaries).map(([monthStr, dates]) => (
              <div key={monthStr} className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 mt-2 px-3 text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-800 py-1">
                  {monthStr}
                </h3>
                {dates.map((date) => (
                  <button
                    key={date}
                    onClick={() => onSelectDiary && onSelectDiary(date)}
                    className={`flex items-center w-full px-3 py-2 text-sm text-left rounded-md transition-colors ${
                      currentDate === date 
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium" 
                        : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <CalendarIcon size={16} className={`mr-3 ${currentDate === date ? "text-blue-500" : "text-gray-400"}`} />
                    {date}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border-color)] p-4 bg-gray-50 dark:bg-gray-800/50">
          <button 
            onClick={() => setSettingsOpen(true)}
            className="flex items-center w-full px-3 py-2 text-sm text-left rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            <Settings size={18} className="mr-3 opacity-70" />
            환경설정
          </button>
        </div>
      </div>
      
      {/* Overlay for mobile when sidebar is open */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-10 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
