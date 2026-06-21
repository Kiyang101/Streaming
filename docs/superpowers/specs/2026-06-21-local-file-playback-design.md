# Local File Playback — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming)

## Summary

Add a new page `/local` that plays video files straight from the user's machine
**without uploading** — no `/api/upload`, no FFmpeg transcode, no HLS. Each file
is read in the browser via `URL.createObjectURL(file)` and set directly as the
`<video>` element's `src` (native decode).

The page supports a **queue** of multiple files (pick several, click to switch)
and **remembers** the chosen files across reloads using the File System Access
API: it stores `FileSystemFileHandle`s in IndexedDB (the handles, not the file
bytes). Browsers that lack the API (notably VS Code's Simple Browser, the user's
environment) fall back to a plain `<input type="file" multiple>` that works for
the current session but cannot remember files.

The existing `Player` component (YouTube-style control overlay) is reused for
playback by adding a `mode` prop that bypasses hls.js for direct-file sources.

## Goals

- Play local video files in the browser with zero upload / server round-trip.
- Reuse the existing `Player` control overlay (scrub, volume, fullscreen,
  fit/fill, keyboard shortcuts) for local-file playback.
- Maintain a queue of multiple files; clicking a queue item switches playback.
- Remember selected files across page reloads via File System Access API +
  IndexedDB (store handles only).
- Degrade gracefully where the File System Access API is unavailable: still play
  for the session via `<input type="file">`, with remembering disabled.

## Non-goals (YAGNI)

- Storing file *bytes* in IndexedDB (handles only — keeps storage tiny).
- Transcoding, quality ladders, or an adaptive-bitrate menu for local files
  (single file → no levels; the quality menu is correctly absent).
- Reordering the queue, autoplay-next, or playlist looping.
- Subtitles / external track loading.
- Persisting playback position per file.

## Architecture

### Playback path — `Player` gains a `mode` prop

`Player` currently always treats `src` as an HLS playlist: it runs
`selectHlsStrategy(...)` and attaches hls.js first (regression-protected for
webview/MSE — commit 401c9e5). That path must stay **untouched**.

Add an optional prop `mode?: "hls" | "file"`, default `"hls"`:

- `mode === "hls"` → existing source-attachment effect, unchanged.
- `mode === "file"` → skip `selectHlsStrategy` / hls.js entirely; set
  `video.src = src` (an object URL) directly. Reset `error`/`levels`/
  `currentLevel` as the HLS branch does. The quality menu hides itself because
  `levels` stays empty.

Everything else in `Player` — control overlay, keyboard shortcuts, fullscreen,
fit/fill, time/buffered wiring — is shared and unchanged. The effect dependency
list becomes `[src, mode]` so switching files (new object URL) re-attaches.

The page owns object-URL lifecycle (create on play, `revokeObjectURL` on switch
/ removal / unmount) so `Player` stays a pure consumer of `src`.

### Remember mechanism — File System Access API + IndexedDB

**Pick:** `window.showOpenFilePicker({ multiple: true })` →
`FileSystemFileHandle[]`. Handles are structured-cloneable, so they are stored
directly in IndexedDB. Only handles are stored — never file bytes.

**Play:** `await handle.getFile()` → `File` → `URL.createObjectURL(file)` →
pass to `Player` as `src` with `mode="file"`.

**Two API constraints the design must absorb:**

1. **Permission is re-requested after reload, and only from a user gesture.**
   The browser will not silently re-grant read access to a stored handle on page
   load. Flow:
   - On load: read stored handles from IndexedDB → show them in the queue with
     status `saved` (visible but not yet playable).
   - User clicks a `saved` item → `handle.requestPermission({ mode: "read" })`
     (the click is the required gesture). Granted → status `ready` → play.
     Denied → status `needs-permission` (stays in queue, re-clickable).
   - A "Restore all" button requests permission for every saved handle in one
     gesture, then plays the first that succeeds.
   - On load we may call `handle.queryPermission({ mode: "read" })` to mark any
     handle already `granted` as `ready` without a prompt.

2. **The API may be absent (VS Code Simple Browser).**
   Feature-detect `"showOpenFilePicker" in window` (in `fileAccess.ts`).
   - Present → handle-based flow above, remembering enabled.
   - Absent → fallback: a hidden `<input type="file" accept="video/*" multiple>`.
     Selected files play for the session (object URLs) but are **not** persisted;
     the UI shows a short note that this browser can't remember files, and the
     IndexedDB layer is not used.

### Queue state — pure reducer

Queue logic lives in `src/lib/localQueue.ts` as a pure reducer so it is unit-
testable without mounting React.

- Item shape: `{ id: string; name: string; size: number; status: LocalFileStatus }`
  where `status ∈ "ready" | "saved" | "needs-permission"`. The live object URL
  for the active item is held in the page (component state), not the reducer, so
  the reducer stays serializable/pure.
- Actions: `add(handles|files)`, `remove(id)`, `setActive(id)`, `setStatus(id,
  status)`, `clear()`. Adding the first item sets it active. Removing the active
  item advances active to the next remaining item (or null).
- `id` generation uses the existing `src/lib/ids.ts` helper for consistency.

### Modules

| File | Role |
|---|---|
| `src/app/local/page.tsx` | **new** — client page: orchestrates queue + permission flow + object-URL lifecycle + `Player` |
| `src/components/LocalQueue.tsx` | **new** — presentational queue list (name, status badge, remove button, "Restore all") |
| `src/lib/localQueue.ts` | **new** — pure queue reducer + types (`LocalQueueItem`, `LocalFileStatus`) |
| `src/lib/localStore.ts` | **new** — IndexedDB wrapper: `saveHandles`, `loadHandles`, `removeHandle`, `clearHandles` |
| `src/lib/fileAccess.ts` | **new** — `supportsFileSystemAccess()`, `pickFiles()`, `ensureReadPermission(handle)`, `fileFromHandle(handle)` |
| `src/components/Player.tsx` | **edit** — add `mode?: "hls" \| "file"` prop |
| `src/components/Sidebar.tsx` | **edit** — add a "Local" nav item |

## Data flow

1. **First visit, API present:** click "Open files" → `pickFiles()` →
   handles → reducer `add` (status `ready`) → `saveHandles` to IndexedDB → first
   item active → `fileFromHandle` → object URL → `Player mode="file"`.
2. **Switch:** click queue item → revoke previous object URL → `getFile` on the
   selected handle → new object URL → `setActive`.
3. **Reload, API present:** `loadHandles` → reducer seeded with `saved`
   (or `ready` if `queryPermission` already granted). Click / "Restore all" →
   `requestPermission` → `ready` → play.
4. **Reload, API absent:** queue starts empty; user re-picks via the
   `<input type="file">` fallback (ephemeral).
5. **Remove:** reducer `remove` + `removeHandle` from IndexedDB + revoke URL.

## Error handling

- Codec the browser cannot decode → `<video>` `error` event → existing `Player`
  error state ("Video playback failed"). (mp4/H.264 reliable; mkv/exotic codecs
  may fail.)
- `showOpenFilePicker` user-cancel (AbortError) → no-op, queue unchanged.
- `requestPermission` denied → status `needs-permission`; item remains, no crash.
- A stored handle whose file was moved/deleted (`getFile` throws
  `NotFoundError`) → mark item `needs-permission` (or surface "file unavailable")
  and skip; do not break the rest of the queue.
- IndexedDB unavailable / throws → log, continue in session-only mode (treat like
  the no-persistence fallback); playback still works.

## Testing

- `localQueue.ts` reducer: `add` sets first item active; `add` appends and keeps
  active; `remove` of active advances active; `remove` of last → active null;
  `setActive` / `setStatus` update correctly; `clear` empties.
- `fileAccess.ts`: `supportsFileSystemAccess()` true when `showOpenFilePicker`
  present, false when absent (stub `window`).
- `Player`: existing `videoFitClass` / `parseFillMode` tests stay green; add a
  guard that `mode="file"` does not invoke the HLS strategy (lightweight — assert
  via the pure-helper level, mirroring existing Player test style).

## Affected files

- `src/app/local/page.tsx` (new)
- `src/components/LocalQueue.tsx` (new)
- `src/lib/localQueue.ts` (new)
- `src/lib/localStore.ts` (new)
- `src/lib/fileAccess.ts` (new)
- `src/components/Player.tsx` (add `mode` prop)
- `src/components/Sidebar.tsx` (add "Local" nav item)
- `tests/` (new unit tests: localQueue, fileAccess)
