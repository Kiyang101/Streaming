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
