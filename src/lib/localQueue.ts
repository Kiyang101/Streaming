// src/lib/localQueue.ts

/** Playback-readiness of a queued local file.
 *  - "ready": permission granted (or just-picked) — playable now.
 *  - "saved": restored from IndexedDB, awaiting a user-gesture permission grant.
 *  - "needs-permission": permission was requested and denied / file unavailable. */
export type LocalFileStatus = "ready" | "saved" | "needs-permission";

export interface LocalQueueItem {
  id: string;
  name: string;
  /** Bytes, or 0 when unknown (handles report size only after getFile()). */
  size: number;
  status: LocalFileStatus;
}

export interface LocalQueueState {
  items: LocalQueueItem[];
  activeId: string | null;
}

export type LocalQueueAction =
  | { type: "add"; items: LocalQueueItem[] }
  | { type: "remove"; id: string }
  | { type: "setActive"; id: string }
  | { type: "setStatus"; id: string; status: LocalFileStatus }
  | { type: "clear" };

export function localQueueReducer(
  state: LocalQueueState,
  action: LocalQueueAction,
): LocalQueueState {
  switch (action.type) {
    case "add": {
      const items = [...state.items, ...action.items];
      const activeId = state.activeId ?? action.items[0]?.id ?? null;
      return { items, activeId };
    }
    default:
      return state;
  }
}
