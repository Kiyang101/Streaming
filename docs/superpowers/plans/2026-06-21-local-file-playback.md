# Local File Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/local` page that plays local video files in the browser with no upload, supports a queue of files, and remembers them across reloads via the File System Access API.

**Architecture:** Files play through `URL.createObjectURL(file)` set directly on the existing `Player`'s `<video>` (new `mode="file"` prop bypasses hls.js). A pure reducer (`localQueue.ts`) owns queue state; `fileAccess.ts` wraps the File System Access API with feature-detection; `localStore.ts` persists `FileSystemFileHandle`s (not bytes) in IndexedDB. Browsers without the API fall back to a session-only `<input type="file">`.

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript, Tailwind, vitest (node env). File System Access API + IndexedDB (browser-only, feature-detected).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/localQueue.ts` | **new** — pure queue reducer + types (no React, no browser APIs) |
| `src/lib/fileAccess.ts` | **new** — File System Access API wrappers + feature-detect |
| `src/lib/localStore.ts` | **new** — IndexedDB persistence of file handles |
| `src/components/Player.tsx` | **edit** — add `mode?: "hls" \| "file"` prop + `usesHlsPipeline` helper |
| `src/components/LocalQueue.tsx` | **new** — presentational queue list |
| `src/app/local/page.tsx` | **new** — orchestration: queue + permission flow + object-URL lifecycle + Player |
| `src/components/Sidebar.tsx` | **edit** — add "Local" nav item |
| `tests/local-queue.test.ts` | **new** — reducer unit tests |
| `tests/file-access.test.ts` | **new** — feature-detect unit test |
| `tests/player-mode.test.ts` | **new** — `usesHlsPipeline` unit test |

Browser-only modules (`fileAccess` wrappers beyond detect, `localStore`, the page, `LocalQueue`) cannot run under vitest's node environment; they are verified manually (see Task 9). Their logic is kept thin and the testable decision-making lives in the pure modules.

---

## Task 1: Queue reducer types + `add` action

**Files:**
- Create: `src/lib/localQueue.ts`
- Test: `tests/local-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/local-queue.test.ts
import { describe, it, expect } from "vitest";
import { localQueueReducer, type LocalQueueState, type LocalQueueItem } from "@/lib/localQueue";

const item = (id: string, status: LocalQueueItem["status"] = "ready"): LocalQueueItem => ({
  id,
  name: `${id}.mp4`,
  size: 0,
  status,
});

const empty: LocalQueueState = { items: [], activeId: null };

describe("localQueueReducer — add", () => {
  it("appends added items and activates the first when queue was empty", () => {
    const next = localQueueReducer(empty, { type: "add", items: [item("a"), item("b")] });
    expect(next.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.activeId).toBe("a");
  });

  it("keeps the existing active item when adding to a non-empty queue", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    const next = localQueueReducer(start, { type: "add", items: [item("b")] });
    expect(next.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.activeId).toBe("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/local-queue.test.ts`
Expected: FAIL — cannot resolve `@/lib/localQueue`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/local-queue.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/localQueue.ts tests/local-queue.test.ts
git commit -m "feat: local queue reducer with add action"
```

---

## Task 2: Queue reducer `remove`, `setActive`, `setStatus`, `clear`

**Files:**
- Modify: `src/lib/localQueue.ts`
- Test: `tests/local-queue.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `tests/local-queue.test.ts`)

```ts
describe("localQueueReducer — remove", () => {
  it("removing a non-active item leaves active unchanged", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "a" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.items.map((i) => i.id)).toEqual(["a"]);
    expect(next.activeId).toBe("a");
  });

  it("removing the active item advances active to the item at the same index", () => {
    const start: LocalQueueState = { items: [item("a"), item("b"), item("c")], activeId: "b" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(next.activeId).toBe("c");
  });

  it("removing the active last item falls back to the new last item", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "b" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.activeId).toBe("a");
  });

  it("removing the only item clears active", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    const next = localQueueReducer(start, { type: "remove", id: "a" });
    expect(next.items).toEqual([]);
    expect(next.activeId).toBeNull();
  });
});

describe("localQueueReducer — setActive / setStatus / clear", () => {
  it("setActive switches to an existing item", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "a" };
    expect(localQueueReducer(start, { type: "setActive", id: "b" }).activeId).toBe("b");
  });

  it("setActive ignores an unknown id", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    expect(localQueueReducer(start, { type: "setActive", id: "zzz" }).activeId).toBe("a");
  });

  it("setStatus updates only the targeted item", () => {
    const start: LocalQueueState = { items: [item("a", "saved"), item("b", "saved")], activeId: "a" };
    const next = localQueueReducer(start, { type: "setStatus", id: "a", status: "ready" });
    expect(next.items.find((i) => i.id === "a")?.status).toBe("ready");
    expect(next.items.find((i) => i.id === "b")?.status).toBe("saved");
  });

  it("clear empties the queue", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    expect(localQueueReducer(start, { type: "clear" })).toEqual({ items: [], activeId: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/local-queue.test.ts`
Expected: FAIL — `remove`/`setActive`/`setStatus`/`clear` fall through to default, so assertions on `activeId`/`items` do not match.

- [ ] **Step 3: Implement the remaining cases** (replace the `default` arm in `localQueueReducer`)

```ts
    case "remove": {
      const index = state.items.findIndex((i) => i.id === action.id);
      if (index === -1) return state;
      const items = state.items.filter((i) => i.id !== action.id);
      let activeId = state.activeId;
      if (state.activeId === action.id) {
        // Advance to whatever now sits at the removed slot, else the new last,
        // else nothing.
        activeId = items.length === 0 ? null : items[Math.min(index, items.length - 1)].id;
      }
      return { items, activeId };
    }
    case "setActive": {
      if (!state.items.some((i) => i.id === action.id)) return state;
      return { ...state, activeId: action.id };
    }
    case "setStatus": {
      const items = state.items.map((i) =>
        i.id === action.id ? { ...i, status: action.status } : i,
      );
      return { ...state, items };
    }
    case "clear":
      return { items: [], activeId: null };
    default:
      return state;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/local-queue.test.ts`
Expected: PASS (all `localQueueReducer` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/localQueue.ts tests/local-queue.test.ts
git commit -m "feat: local queue reducer remove/setActive/setStatus/clear"
```

---

## Task 3: `usesHlsPipeline` helper + `mode` prop on Player

**Files:**
- Modify: `src/components/Player.tsx`
- Test: `tests/player-mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/player-mode.test.ts
import { describe, it, expect } from "vitest";
import { usesHlsPipeline } from "@/components/Player";

/** Player exports a pure helper for the mode branch so the hls.js-vs-direct-file
 *  decision can be unit-tested in the node env (no DOM), mirroring videoFitClass. */
describe("usesHlsPipeline", () => {
  it("uses the hls.js pipeline for hls mode (the default)", () => {
    expect(usesHlsPipeline("hls")).toBe(true);
  });
  it("bypasses the hls.js pipeline for direct file playback", () => {
    expect(usesHlsPipeline("file")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/player-mode.test.ts`
Expected: FAIL — `usesHlsPipeline` is not exported from `@/components/Player`.

- [ ] **Step 3: Add the helper and the prop**

In `src/components/Player.tsx`, add the exported helper near `parseFillMode` (after line 36):

```ts
/** Playback mode. "hls" runs the hls.js/native HLS pipeline (default, for
 *  transcoded VOD/live). "file" plays a direct media source (object URL) on the
 *  native <video> with no manifest parsing — used for local files. */
export type PlayerMode = "hls" | "file";

/** True when the source should go through the HLS pipeline; false for a direct
 *  file source set straight on video.src. */
export function usesHlsPipeline(mode: PlayerMode): boolean {
  return mode !== "file";
}
```

Update the component signature (currently lines 54-60) to accept `mode`:

```ts
export default function Player({
  src,
  mode = "hls",
  onTimeUpdate,
}: {
  src: string;
  mode?: PlayerMode;
  onTimeUpdate?: (seconds: number) => void;
}) {
```

In the source-attachment effect, insert the file branch right after the three
reset calls (`setError(null); setLevels([]); setCurrentLevel(AUTO_LEVEL);`) and
before `const strategy = selectHlsStrategy(...)`:

```ts
    // Direct-file playback (local files): no manifest, no hls.js — set the object
    // URL straight on the element. The quality menu stays hidden (levels empty).
    if (!usesHlsPipeline(mode)) {
      video.src = src;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
```

Change the effect dependency array from `[src]` to `[src, mode]` (the
dependency list at the end of that effect, currently line 137).

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run tests/player-mode.test.ts tests/player-fill.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Player.tsx tests/player-mode.test.ts
git commit -m "feat: Player mode prop for direct local-file playback"
```

---

## Task 4: File System Access feature-detect

**Files:**
- Create: `src/lib/fileAccess.ts`
- Test: `tests/file-access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/file-access.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { supportsFileSystemAccess } from "@/lib/fileAccess";

// vitest runs in the node env where `window` is undefined; stub it per-case.
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("supportsFileSystemAccess", () => {
  it("is false when window is undefined (SSR / node)", () => {
    expect(supportsFileSystemAccess()).toBe(false);
  });
  it("is false when window lacks showOpenFilePicker (e.g. VS Code Simple Browser)", () => {
    (globalThis as Record<string, unknown>).window = {};
    expect(supportsFileSystemAccess()).toBe(false);
  });
  it("is true when showOpenFilePicker is present", () => {
    (globalThis as Record<string, unknown>).window = { showOpenFilePicker: () => {} };
    expect(supportsFileSystemAccess()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/file-access.test.ts`
Expected: FAIL — cannot resolve `@/lib/fileAccess`.

- [ ] **Step 3: Write the module** (detect + browser wrappers)

```ts
// src/lib/fileAccess.ts

/** True when the File System Access API is available (lets us persist handles
 *  and re-acquire files across reloads). Absent in some embedded webviews such
 *  as VS Code's Simple Browser, where the caller falls back to <input type=file>. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

/** Open the system picker for one or more video files. Rejects with an
 *  AbortError if the user cancels — callers should swallow that. */
export async function pickFiles(): Promise<FileSystemFileHandle[]> {
  return await window.showOpenFilePicker({ multiple: true });
}

/** Ensure read permission for a stored handle. queryPermission avoids a prompt
 *  when already granted; requestPermission MUST be called from a user gesture.
 *  Returns true only when read access is granted. */
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** Read-only check (no prompt) used at restore time to mark already-granted
 *  handles as ready without interrupting the user. */
export async function hasReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: "read" })) === "granted";
}

/** Resolve a handle to a File for object-URL playback. */
export async function fileFromHandle(handle: FileSystemFileHandle): Promise<File> {
  return await handle.getFile();
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/file-access.test.ts`
Expected: PASS (3 tests).
Run: `npx tsc --noEmit`
Expected: no errors. (If `showOpenFilePicker`/`queryPermission` types are missing, ensure `"lib": ["dom", ...]` is in `tsconfig.json` — it already is for this Next.js app. Do **not** add `any` casts; the DOM lib ships these types.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/fileAccess.ts tests/file-access.test.ts
git commit -m "feat: File System Access wrappers + feature detect"
```

---

## Task 5: IndexedDB handle store

**Files:**
- Create: `src/lib/localStore.ts`

Browser-only (IndexedDB is not in vitest's node env). No unit test; verified in
Task 9. Keep it a thin, single-purpose wrapper.

- [ ] **Step 1: Write the module**

```ts
// src/lib/localStore.ts

/** Persists FileSystemFileHandles (NOT file bytes) so the /local queue survives
 *  reloads. Each record keeps the handle plus the file name captured at save
 *  time, so the queue can show names before the user re-grants permission. */

const DB_NAME = "local-playback";
const STORE = "handles";
const VERSION = 1;

export interface StoredHandle {
  id: string;
  name: string;
  handle: FileSystemFileHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Append/replace records (keyed by id). */
export async function saveHandles(records: StoredHandle[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    for (const r of records) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** All stored handles, in insertion order. */
export async function loadHandles(): Promise<StoredHandle[]> {
  return (await tx<StoredHandle[]>("readonly", (s) => s.getAll())) ?? [];
}

export async function removeHandle(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function clearHandles(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/localStore.ts
git commit -m "feat: IndexedDB store for local file handles"
```

---

## Task 6: LocalQueue presentational component

**Files:**
- Create: `src/components/LocalQueue.tsx`

Presentational only — no browser APIs. Verified visually in Task 9.

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/LocalQueue.tsx
git commit -m "feat: LocalQueue presentational component"
```

---

## Task 7: `/local` page — orchestration

**Files:**
- Create: `src/app/local/page.tsx`

Wires the reducer, permission flow, object-URL lifecycle, picker/fallback, and
Player. Browser-only; verified in Task 9.

- [ ] **Step 1: Write the page**

```tsx
// src/app/local/page.tsx
"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Player from "@/components/Player";
import LocalQueue from "@/components/LocalQueue";
import { newId } from "@/lib/ids";
import {
  localQueueReducer,
  type LocalQueueItem,
  type LocalQueueState,
} from "@/lib/localQueue";
import {
  supportsFileSystemAccess,
  pickFiles,
  ensureReadPermission,
  hasReadPermission,
  fileFromHandle,
} from "@/lib/fileAccess";
import { saveHandles, loadHandles, removeHandle } from "@/lib/localStore";

const INITIAL: LocalQueueState = { items: [], activeId: null };

export default function LocalPage() {
  const [state, dispatch] = useReducer(localQueueReducer, INITIAL);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  // Source-of-truth for the live File/handle objects, kept out of the
  // serializable reducer state. Maps queue item id -> handle (FS Access) or File
  // (fallback input).
  const handles = useRef(new Map<string, FileSystemFileHandle>());
  const files = useRef(new Map<string, File>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUrlRef = useRef<string | null>(null);

  // Detect support after mount (window is unavailable during SSR).
  useEffect(() => {
    setSupported(supportsFileSystemAccess());
  }, []);

  // Restore saved handles on mount (FS Access only). Mark already-granted ones
  // ready; the rest stay "saved" until a user gesture re-grants permission.
  useEffect(() => {
    if (!supportsFileSystemAccess()) return;
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadHandles();
        if (cancelled || saved.length === 0) return;
        const seeded: LocalQueueItem[] = [];
        for (const r of saved) {
          handles.current.set(r.id, r.handle);
          const granted = await hasReadPermission(r.handle);
          seeded.push({ id: r.id, name: r.name, size: 0, status: granted ? "ready" : "saved" });
        }
        if (!cancelled) dispatch({ type: "add", items: seeded });
      } catch {
        // IndexedDB unavailable / blocked — continue session-only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke the active object URL on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
    };
  }, []);

  function setUrl(url: string | null) {
    if (activeUrlRef.current) URL.revokeObjectURL(activeUrlRef.current);
    activeUrlRef.current = url;
    setActiveUrl(url);
  }

  async function playItem(id: string) {
    // Fallback input path: File already in hand.
    const file = files.current.get(id);
    if (file) {
      setUrl(URL.createObjectURL(file));
      dispatch({ type: "setActive", id });
      return;
    }
    // FS Access path: ensure permission (user gesture), then read the File.
    const handle = handles.current.get(id);
    if (!handle) return;
    const ok = await ensureReadPermission(handle);
    if (!ok) {
      dispatch({ type: "setStatus", id, status: "needs-permission" });
      return;
    }
    try {
      const resolved = await fileFromHandle(handle);
      setUrl(URL.createObjectURL(resolved));
      dispatch({ type: "setStatus", id, status: "ready" });
      dispatch({ type: "setActive", id });
    } catch {
      // File moved/deleted since it was saved.
      dispatch({ type: "setStatus", id, status: "needs-permission" });
    }
  }

  async function openFiles() {
    if (supported) {
      let picked: FileSystemFileHandle[];
      try {
        picked = await pickFiles();
      } catch {
        return; // user cancelled (AbortError)
      }
      const items: LocalQueueItem[] = picked.map((h) => ({
        id: newId(),
        name: h.name,
        size: 0,
        status: "ready",
      }));
      items.forEach((it, i) => handles.current.set(it.id, picked[i]));
      try {
        await saveHandles(items.map((it, i) => ({ id: it.id, name: it.name, handle: picked[i] })));
      } catch {
        // Persisting failed; playback for this session still works.
      }
      const wasEmpty = state.activeId === null;
      dispatch({ type: "add", items });
      if (wasEmpty && items[0]) void playItem(items[0].id);
    } else {
      fileInputRef.current?.click();
    }
  }

  function onFallbackPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("video/"));
    e.target.value = "";
    if (picked.length === 0) return;
    const items: LocalQueueItem[] = picked.map((f) => ({
      id: newId(),
      name: f.name,
      size: f.size,
      status: "ready",
    }));
    items.forEach((it, i) => files.current.set(it.id, picked[i]));
    const wasEmpty = state.activeId === null;
    dispatch({ type: "add", items });
    if (wasEmpty && items[0]) void playItem(items[0].id);
  }

  async function restoreAll() {
    for (const it of state.items) {
      if (it.status === "ready") continue;
      const handle = handles.current.get(it.id);
      if (!handle) continue;
      if (await ensureReadPermission(handle)) {
        await playItem(it.id);
        return; // first restored item becomes active
      }
      dispatch({ type: "setStatus", id: it.id, status: "needs-permission" });
    }
  }

  function removeItem(id: string) {
    if (id === state.activeId) setUrl(null);
    handles.current.delete(id);
    files.current.delete(id);
    if (supported) void removeHandle(id);
    dispatch({ type: "remove", id });
  }

  const hasRestorable = state.items.some((i) => i.status !== "ready");

  return (
    <div className="mx-auto max-w-screen-xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-yt-text">Local files</h1>
        <button
          type="button"
          onClick={openFiles}
          className="rounded-full bg-yt-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yt-redHover"
        >
          Open files
        </button>
      </div>

      <p className="mb-6 text-sm text-yt-subtext">
        Play videos straight from your device — nothing is uploaded.
        {!supported && " This browser can't remember files, so the queue clears on reload."}
      </p>

      {/* Hidden fallback input for browsers without the File System Access API. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={onFallbackPick}
        className="hidden"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          {activeUrl ? (
            <Player key={activeUrl} src={activeUrl} mode="file" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-xl bg-yt-surface text-center">
              <p className="text-yt-subtext">
                {state.items.length === 0
                  ? "Open a video file to start playing."
                  : "Select a file from the queue."}
              </p>
            </div>
          )}
        </div>
        <LocalQueue
          items={state.items}
          activeId={state.activeId}
          showRestoreAll={hasRestorable}
          onSelect={(id) => void playItem(id)}
          onRemove={removeItem}
          onRestoreAll={() => void restoreAll()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds; `/local` listed as a route.

- [ ] **Step 3: Commit**

```bash
git add src/app/local/page.tsx
git commit -m "feat: /local page orchestrating queue + file playback"
```

---

## Task 8: Sidebar "Local" nav item

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add the nav item**

In `src/components/Sidebar.tsx`, append a third entry to the `NAV_ITEMS` array
(after the "Live" item, before the closing `]` near line 38):

```tsx
  {
    href: "/local",
    label: "Local",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 4v10h16V8H4zm6 2l5 3-5 3v-6z" />
      </svg>
    ),
  },
```

The existing `isActive` falls through to `pathname === href`, which correctly
highlights `/local` — no change needed there.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Local to the sidebar nav"
```

---

## Task 9: Manual verification + README note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: PASS, including the new `local-queue`, `file-access`, and `player-mode`
tests, with no regressions in existing tests.

- [ ] **Step 2: Manual browser verification**

Start the app: `npm run dev`, open `http://localhost:3000/local`.

In a Chromium browser (File System Access API present):
1. Click **Open files**, pick one or more `.mp4` files → first plays in the
   Player overlay (scrub, volume, fullscreen, fit/fill all work); others appear
   in the queue.
2. Click a queue item → playback switches to it.
3. **Reload** → queue reappears with items marked "Click to load"; clicking one
   prompts for permission, then plays. **Restore all** re-grants in one click.
4. Remove an item with `×` → it leaves the queue and IndexedDB; removing the
   active item clears the Player.

In VS Code Simple Browser (no File System Access API):
5. The page shows the "can't remember files" note; **Open files** opens the OS
   file dialog; selected videos play for the session; reload clears the queue.

- [ ] **Step 3: Document the feature in README**

Add this section to `README.md` after the "VOD demo" section:

```markdown
## Local files (no upload)

Open http://localhost:3000/local to play video files straight from your device —
no upload, no transcode. Pick one or more files; they queue up and play through
the same player. In browsers with the File System Access API (e.g. Chrome) the
queue is remembered across reloads (you re-grant read access on return). In
browsers without it (e.g. VS Code's Simple Browser) playback is session-only.

Playback uses the browser's native decoder, so well-supported formats (MP4 /
H.264) are most reliable; some containers/codecs (e.g. MKV) may not play.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the /local no-upload playback feature"
```

---

## Self-Review Notes

- **Spec coverage:** zero-upload object-URL playback (Tasks 3, 7); Player overlay
  reuse via `mode` prop (Task 3); multi-file queue + switch (Tasks 1-2, 6-7);
  remember via FS Access + IndexedDB handles-only (Tasks 4-5, 7); permission
  re-request on reload from a gesture + "Restore all" (Task 7); graceful fallback
  for browsers without the API (Tasks 4, 7); codec-failure → existing Player
  error state (relies on unchanged Player error wiring); pure-reducer + detect
  tests (Tasks 1-2, 4); Sidebar entry (Task 8). All spec sections map to a task.
- **Type consistency:** `LocalQueueItem`/`LocalFileStatus`/`LocalQueueState`/
  `LocalQueueAction` defined in Task 1 and used unchanged in 6-7;
  `usesHlsPipeline`/`PlayerMode` defined in Task 3 and consumed by the Player
  effect; `StoredHandle` (Task 5) matches the `{ id, name, handle }` objects
  built in Task 7's `saveHandles` call and read by `loadHandles`.
- **Placeholders:** none — every code/edit step shows complete content.
