import { FileText, X } from "lucide-react";
import type { Document } from "../api";

interface TabBarProps {
  tabs: Document[];
  activeIndex: number;
  isReading: boolean;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
}

export function TabBar({ tabs, activeIndex, isReading, onSelect, onClose }: TabBarProps) {
  return (
    <div className="flex flex-1 overflow-x-auto no-scrollbar items-center h-full" role="tablist">
      {tabs.map((tab, idx) => {
        const isActive = isReading && idx === activeIndex;
        return (
          <div
            key={`${tab.id}-${idx}`}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            className={`flex items-center gap-2 px-4 h-full cursor-pointer border-r border-[var(--border-color)] text-sm max-w-[200px] transition-colors
              ${
                isActive
                  ? "bg-[var(--bg-primary)] border-t-3 border-t-[var(--accent)] text-primary font-medium"
                  : "bg-[var(--bg-secondary)] text-secondary border-t-3 border-t-transparent hover:bg-[var(--bg-tertiary)]"
              }`}
            onClick={() => onSelect(idx)}
            onAuxClick={(e) => {
              // Middle-click closes, matching every browser and editor.
              if (e.button === 1) {
                e.preventDefault();
                onClose(idx);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(idx);
              }
            }}
          >
            <FileText size={14} className={isActive ? "text-primary" : "text-muted"} aria-hidden="true" />
            <span className="truncate select-none">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(idx);
              }}
              aria-label={`Close ${tab.title}`}
              title="Close tab"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
