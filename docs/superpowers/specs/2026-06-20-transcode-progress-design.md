# Transcode Progress Indicator — Design

**Date:** 2026-06-20
**Status:** Approved, ready for implementation planning
**Branch:** feat/youtube-redesign

## Goal

After a VOD upload finishes transferring, the file is transcoded by ffmpeg
(fire-and-forget) while the library card sits on a static "Processing" badge with
no sense of how long it will take. Surface a **real transcode percentage** (0–100)
on that card — a thin progress bar plus a `NN%` label — so the user can see the
work advancing toward "ready".

## Scope

- **In scope:** computing a true transcode percentage from ffmpeg, persisting it,
  exposing it through the existing `/api/videos` poll, and rendering it on the
  processing card; adaptive poll cadence so the number actually moves; tests.
- **Out of scope (deferred):** real-time push (SSE/WebSocket) — the existing
  polling channel is reused instead; progress for live streams (which have no
  finite duration); per-rendition progress breakdown.

## Background — current state

- `transcodeToHls(inputPath, outDir): Promise<void>` in `src/lib/transcode.ts`
  spawns ffmpeg with `stdio: ["ignore", "ignore", "pipe"]` (stderr captured for
  error messages) and resolves on clean exit.
- `src/app/api/upload/route.ts` inserts the video as `status: "processing"`, then
  fire-and-forget `transcodeToHls(...).then(poster + setStatus("ready"))`.
- `src/app/page.tsx` polls `/api/videos` every 4s and re-renders the grid.
- `VideoCard.tsx` renders a static `STATUS_BADGE.processing` chip; no progress.
- `Video` (in `src/lib/types.ts`) has no progress field. The DB `videos` table
  already gained a nullable `thumbnail TEXT` column via a `try/catch ALTER TABLE`
  migration — the same pattern applies here.

## Approach

Reuse the existing 4s polling channel rather than introducing a streaming
transport. ffmpeg computes progress; the DB stores it; the poll carries it; the
card shows it. This keeps every unit independently testable and adds no new
infrastructure (YAGNI on SSE/WebSocket).

## Components & changes

### 1. Progress capture — `src/lib/transcode.ts`

- Add `probeDuration(inputPath: string): Promise<number>` — spawns
  `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 <input>`
  and resolves the duration in seconds. Rejects on missing input / non-zero exit.
- Extend the signature to
  `transcodeToHls(inputPath, outDir, onProgress?: (percent: number) => void)`.
  The third parameter is **optional**, so existing 2-arg callers and tests are
  unaffected.
- Add `-progress pipe:1` to the ffmpeg args and change stdio to
  `["ignore", "pipe", "pipe"]`: parse `out_time_us` (microseconds) from stdout,
  compute `percent = min(99, round(out_time_s / duration * 100))`, and invoke
  `onProgress(percent)` only when the whole-number percent **increases**
  (throttling). Force `onProgress(100)` on clean exit.
- The ffmpeg HLS output args are otherwise unchanged — `master.m3u8`, the
  rendition playlists, and `.ts` segments are produced exactly as before.
- **Graceful degradation:** if `probeDuration` fails (e.g. ffprobe unavailable),
  transcoding proceeds normally and `onProgress` is simply never called with a
  computed value; the card falls back to an indeterminate "Processing…" state.

### 2. Persistence — `src/lib/db.ts` & `src/lib/types.ts`

- Add a nullable `progress INTEGER` column to the `videos` CREATE TABLE plus a
  `try { ALTER TABLE videos ADD COLUMN progress INTEGER } catch {}` migration for
  pre-existing DBs (mirrors the `thumbnail` migration).
- Add `setProgress(id: string, percent: number): void` — `UPDATE videos SET
  progress = ? WHERE id = ?`. `insertVideo`'s existing column binding is
  untouched; new rows start with `progress = NULL`.
- Add `progress?: number` to the `Video` interface (whole-number percent, 0–100).

### 3. Wiring — `src/app/api/upload/route.ts`

- Pass `onProgress: (p) => setProgress(id, p)` as the third argument to
  `transcodeToHls`. The existing sequence is preserved: transcode → poster
  extraction (best-effort) → `setStatus(id, "ready")`. Poster and progress
  failures must never flip the video to `failed`.

### 4. UI — `src/components/VideoCard.tsx` & `src/app/page.tsx`

- **VideoCard:** while `status === "processing"`, render a thin progress bar plus
  a `NN%` label in place of the plain "Processing" chip, reusing the upload-bar
  styling (`h-2 … bg-yt-red`, `width: NN%`). When `progress` is `null`/`undefined`,
  render an indeterminate bar (animated, no number). Other statuses are unchanged;
  only `ready` videos remain links.
- **page.tsx:** make the poll cadence adaptive — **2s** while any listed video has
  `status === "processing"`, otherwise **4s** — so the percentage visibly advances
  without over-polling an idle library.

## Data flow

```
upload route  ──insert(processing, progress=NULL)──▶ sqlite
   │
   └─ transcodeToHls(input, outDir, onProgress)
          │  ffprobe → duration
          │  ffmpeg -progress pipe:1 → out_time_us
          └─ onProgress(percent) ──setProgress(id, percent)──▶ sqlite
                                                                  │
page.tsx poll (2s while processing) ── GET /api/videos ──────────┘
   └─ VideoCard renders bar + NN% while status==processing
```

## Error handling

- `probeDuration` / ffprobe failure → no computed progress; card shows
  indeterminate "Processing…"; transcode and `ready` transition proceed normally.
- Malformed / missing `out_time_us` lines on stdout are ignored.
- Progress is advisory: it never blocks, delays, or fails the `ready` transition.
- A video that fails transcode still goes to `failed` exactly as today.

## Testing

- **transcode:** `onProgress` is invoked with monotonically increasing values
  during transcode of `tests/fixtures/sample.mp4` and ends at `100`;
  `probeDuration` returns a positive number for the fixture and rejects on missing
  input; existing 2-arg `transcodeToHls` tests still pass (poster + master
  playlist behavior unchanged).
- **db:** `setProgress` persists and `getVideo` returns it; a freshly inserted row
  has `progress` null/undefined.
- **VideoCard:** decision-level test (vitest runs `environment: 'node'`, no
  jsdom/RTL) — processing + numeric progress yields a percent; `ready` yields no
  progress UI; processing without progress yields the indeterminate state.
- **Regression:** all currently-passing tests stay green; the hls.js-first
  playback path (`tests/hls-strategy.test.ts`, player code) is not touched.

## Acceptance

- `npm test` passes fully (existing + new).
- Uploading a video shows a moving percentage on its card that climbs to ~100%
  and then flips to a watchable "ready" card.
- ffprobe being unavailable degrades to an indeterminate bar, not an error.
