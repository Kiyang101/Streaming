# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only video-streaming prototype (Next.js 15 App Router, React 19, TypeScript). It plays video three ways:
- **VOD**: upload → FFmpeg transcode to an HLS ABR ladder → adaptive playback.
- **Live**: OBS → RTMP ingest → HLS → playback at `/live/<key>`.
- **Local files**: played straight from the device via the File System Access API, no upload or transcode (`/local`).

## Commands

```bash
npm run dev            # Next.js app at http://localhost:3000
npm run media-server   # Standalone RTMP ingest at rtmp://localhost:1935 (separate process)
npm run build          # next build
npm test               # vitest run (all tests)
npx vitest run tests/transcode.test.ts        # single test file
npx vitest run -t "name of test"               # single test by name
npx vitest                                      # watch mode
```

The app and the media server are **two separate processes**. The Next.js app does VOD transcoding and HLS playback in-process; `media-server.mjs` is a standalone Node process that only handles live RTMP→HLS.

## External dependencies (must be on PATH)

- **FFmpeg / ffprobe** — all transcoding, poster extraction, and duration probing shells out to these. No JS fallback; tests that exercise real transcoding need them installed.
- **OBS Studio** — only for the live demo. Configure Stream → Custom, Server `rtmp://localhost:1935/live`, Stream Key `devkey` (or whatever `LIVE_STREAM_KEY` is).

Config via `.env.local` (copy from `.env.local.example`): `RTMP_PORT`, `LIVE_STREAM_KEY`, `FFMPEG_PATH`.

## Architecture

### Media is filesystem state, not just DB rows
Everything lives under `media/` (gitignored). The SQLite DB (`media/library.db`) tracks VOD metadata, but **the filesystem is the source of truth for playback availability**:
- Live "is it on air?" = does `media/live/<key>/index.m3u8` exist on disk (`src/lib/live.ts`). There is no live DB row.
- VOD playback = HLS segments under `media/vod/<id>/`, written by FFmpeg.
- All browser access to media files goes through one route: `src/app/media/[...path]/route.ts`, which guards against path traversal and serves from `media/`. Relative paths like `vod/<id>/master.m3u8` are stored in the DB and resolved through this route.

`src/lib/paths.ts` is the single place that maps ids/keys ↔ filesystem and browser-URL paths. Use its helpers rather than hand-building paths.

### VOD upload pipeline (`src/app/api/upload/route.ts`)
Upload responds immediately with `status: "processing"`, then transcodes **fire-and-forget**: `transcodeToHls` runs in the background and flips the DB status to `ready`/`failed` on completion. The client polls `GET /api/videos`. Two things are deliberately best-effort and must **never** block the `ready` transition: progress updates (`setProgress`) and poster extraction (`extractPosterAt`). Keep that invariant if you touch this code.

### Transcoding (`src/lib/transcode.ts`)
The FFmpeg argument builders (`buildHlsArgs`, `posterArgs`, `imageArgs`) are **pure functions** — separated from process spawning specifically so they can be unit-tested without FFmpeg. When changing transcode behavior, change the pure builder and assert on its args; don't bury logic in the spawn wrapper. Progress is derived by parsing FFmpeg's `-progress pipe:1` `out_time_us` lines against a probed duration.

### HLS playback strategy (`src/lib/hlsStrategy.ts`)
`selectHlsStrategy` decides hls.js vs native vs unsupported. **hls.js (MSE) is preferred wherever supported** — this is intentional: some embedded webviews (notably VS Code's Simple Browser, a primary preview target here) report native HLS as playable but render a black video. Native HLS is a fallback only where MSE is unavailable (e.g. iOS Safari). Don't "simplify" this back to preferring native.

### Live media server (`media-server.mjs`)
`node-media-server` accepts RTMP and transcodes to HLS into `media/live/<key>/`. A `prePublish` hook rejects any stream key ≠ `LIVE_STREAM_KEY`. This is a `.mjs` file run directly by Node, outside the Next build.

### Local-file playback (`/local`)
No server involvement. `src/lib/fileAccess.ts` wraps the File System Access API; `src/lib/localStore.ts` persists `FileSystemFileHandle`s (handles, **not** bytes) in IndexedDB so the queue survives reloads — the user re-grants read permission on return. Browsers without the API (VS Code Simple Browser) fall back to `<input type=file>` and are session-only. Anything calling `requestPermission` must run from a user gesture.

## Conventions

- Path alias `@/*` → `src/*` (set in both `tsconfig.json` and `vitest.config.ts`).
- `newId()` (`src/lib/ids.ts`) uses global `crypto.randomUUID()` (no `node:crypto` import) because it's also called from the `"use client"` `/local` page and must be browser-bundleable.
- `better-sqlite3` is a native module pinned to `serverExternalPackages` in `next.config.ts` — keep it out of the bundle.
- Tests are in `tests/` (vitest, node environment). The DB layer accepts `":memory:"` for isolated tests. Favor extracting pure functions for anything that otherwise needs FFmpeg/filesystem/browser APIs — that's the established pattern for testability here.

## Design docs

Specs and plans for each feature live in `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated). Check these for the intent behind a feature before reworking it.
