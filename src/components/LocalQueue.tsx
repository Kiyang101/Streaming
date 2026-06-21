// src/components/LocalQueue.tsx
"use client";

import type { LocalQueueItem } from "@/lib/localQueue";

const STATUS_LABEL: Record<LocalQueueItem["status"], string> = {
  ready: "",
  saved: "Click to load",
  "needs-permission": "Grant access",
};

export default function LocalQueue({
  items,
  activeId,
  showRestoreAll,
  onSelect,
  onRemove,
  onRestoreAll,
}: {
  items: LocalQueueItem[];
  activeId: string | null;
  /** Show the "Restore all" action (any saved/needs-permission items exist). */
  showRestoreAll: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onRestoreAll: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl bg-yt-surface p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <h2 className="text-sm font-medium text-yt-text">Queue</h2>
        {showRestoreAll && (
          <button
            type="button"
            onClick={onRestoreAll}
            className="rounded-full px-2 py-0.5 text-xs font-medium text-yt-subtext hover:text-yt-text"
          >
            Restore all
          </button>
        )}
      </div>
      <ul className="flex flex-col">
        {items.map((it) => {
          const active = it.id === activeId;
          const hint = STATUS_LABEL[it.status];
          return (
            <li key={it.id} className="group/item flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                aria-current={active ? "true" : undefined}
                className={`flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/10 ${
                  active ? "bg-white/10 font-medium text-yt-text" : "text-yt-subtext"
                }`}
                title={it.name}
              >
                <span className="truncate">{it.name}</span>
                {hint && <span className="ml-2 text-xs text-yt-red">{hint}</span>}
              </button>
              <button
                type="button"
                onClick={() => onRemove(it.id)}
                aria-label={`Remove ${it.name}`}
                className="px-2 text-yt-subtext opacity-0 transition-opacity hover:text-yt-text group-hover/item:opacity-100"
              >
                &times;
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
