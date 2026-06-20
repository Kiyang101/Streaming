# 4K AI Upscaling — Design Spec

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation plan

## Overview

Add an opt-in "Upscale to 4K" action to ready VODs. When triggered, a background
job AI-upscales the **original uploaded file** using `realesrgan-ncnn-vulkan`
(Real-ESRGAN, running on Metal via Vulkan on Apple Silicon), then rebuilds the
VOD's HLS adaptive-bitrate ladder to include a genuine 2160p rendition. Progress
is surfaced on the video card, reusing the existing transcode-progress pattern.

This delivers true super-resolution (invented detail), not a plain stretch.

### Goals
- Genuinely sharper VOD playback via a real 2160p rendition.
- Opt-in per video; no automatic upscaling on upload.
- Reuse existing ffmpeg pipeline, SQLite store, and progress UI patterns.
- Stay within the current Node + ffmpeg architecture (no Python/PyTorch/CUDA).

### Non-goals (YAGNI)
- No quality/scale selector — target is fixed at 3840×2160.
- No real-time / on-demand upscaling (the technique is inherently slow).
- No HEVC/AV1 output — stays on libx264 for browser/hls.js compatibility.
- No multi-machine or cloud-GPU offloading.

## Hardware & performance assumptions
- Runs on Apple Silicon (M-series); `realesrgan-ncnn-vulkan` uses Metal/Vulkan.
- Expect roughly **minutes of processing per minute of video** (varies by chip
  and source resolution). This is a "kick it off and come back later" feature.

## Architecture

### Data flow
```
original upload (media/uploads/<id>.<ext>)
  └─ split into ~15s segments (ffmpeg segment muxer)
       └─ per segment, sequentially:
            ├─ ffmpeg: extract PNG frames → temp dir
            ├─ realesrgan-ncnn-vulkan -s 4 -n realesrgan-x4plus: upscale ×4
            ├─ ffmpeg: reassemble frames, scale=3840:2160, encode segment mp4
            └─ delete that segment's frames (bounds peak disk use)
       └─ concat upscaled segments → 4K master (temp)
            └─ transcodeToHls(4K master, 4K ladder) → temp HLS dir
                 └─ atomic rename into vodDir(id)
```

### Why segment-based
Full-frame extraction of even a 10-minute video produces tens of GB of PNGs
(4K PNG frames are ~8 MB each). Processing one ~15s segment at a time bounds peak
temp-disk usage to roughly one segment's worth of frames.

## Components

### `src/lib/upscale.ts` (new)
`upscaleVideoToHls(inputPath, outDir, onProgress?)` orchestrates the full
pipeline above. Responsibilities:
- Probe duration/fps (reuse `probeDuration`).
- Segment the source, then loop segments sequentially through extract → upscale →
  re-encode, deleting frames after each segment.
- Concat segments into a 4K master, then call `transcodeToHls` with the 4K ladder.
- Build the HLS output in a temp directory and **atomically `rename`** it into
  `vodDir(id)` so playback never observes a half-written ladder.
- Always clean up temp directories in a `finally`.
- Report progress at **segment granularity** (`segmentsDone / totalSegments`).
- Honor `REALESRGAN_PATH` env var (default `realesrgan-ncnn-vulkan`); pass the
  model name (`realesrgan-x4plus`) and models dir via `-m`.

Pure, testable helpers to extract:
- segment-count math from duration + segment length
- segment-progress → percent mapping

### `src/lib/transcode.ts` (modify)
Refactor `transcodeToHls` to accept an optional **ladder spec**:
`Array<{ width: number; height: number; bitrate: string }>`.
- Default preserves current behavior exactly: `[{1280,720,2800k}, {854,480,1400k}]`.
- The `-filter_complex`, `-map`, `-var_stream_map`, and per-variant bitrate args
  are generated from the ladder spec instead of being hardcoded.
- 4K ladder used by the upscale job:
  - 2160p @ ~16000k
  - 1080p @ ~5000k
  - 720p  @ ~2800k
- Stays on `libx264` (not HEVC) for browser/hls.js playback.

Extract a pure **ladder → ffmpeg-args builder** function for unit testing.

### `src/lib/db.ts` + `src/lib/types.ts` (modify)
Add two columns kept separate from the upload-time `status`/`progress` so the two
operations never clobber each other. Use the existing
`try { ALTER TABLE … } catch {}` migration pattern.

`types.ts`:
```ts
upscaleStatus?: "none" | "upscaling" | "upscaled" | "failed";
upscaleProgress?: number; // whole-number percent (0–100)
```

`db.ts`: add `setUpscaleStatus(id, status)` and `setUpscaleProgress(id, percent)`,
plus the two `ALTER TABLE` migrations in `openDb`.

### `src/lib/paths.ts` (modify)
Add `findUpload(id)` helper that globs `media/uploads/<id>.*` and returns the
original source path (the upload route already leaves the original in place).
Add a temp-dir path helper for upscale scratch space (e.g. under `media/tmp/`).

### `src/app/api/videos/[id]/upscale/route.ts` (new)
`POST` starts a fire-and-forget job (same pattern as `api/upload`):
- 404 if the video does not exist.
- 409 if the video is not `ready`, or is already `upscaling` / `upscaled`.
- Module-level **single-job lock**: only one upscale runs at a time across the
  whole server (protects GPU/disk); concurrent requests get 409.
- Resolve the source via `findUpload(id)`.
- Set `upscaleStatus = "upscaling"`; stream progress via `setUpscaleProgress`.
- On success: `upscaleStatus = "upscaled"`. On error: `"failed"`, logged.
- Temp dirs cleaned in `finally`; original upload and existing HLS untouched on
  failure (atomic swap guarantees a failed run never corrupts the playable copy).

### `src/components/VideoCard.tsx` + `src/app/page.tsx` (modify)
- Ready video, not yet upscaled → small **"Upscale to 4K"** button that POSTs to
  the upscale route.
- `upscaling` → progress bar driven by `upscaleProgress` (reuse
  `progressDisplay` / `ProgressBar`).
- `upscaled` → a **"4K" badge** on the card.
- `page.tsx`: keep the fast 2s poll interval while anything is `upscaling` (extend
  the existing `hasProcessing` check).

## Configuration
- `REALESRGAN_PATH` env var, default `realesrgan-ncnn-vulkan` (mirrors `FFMPEG_PATH`).
- README documents install: `brew install realesrgan-ncnn-vulkan` (or download the
  release binary + `realesrgan-x4plus` model). Job fails with a clear error if the
  binary is missing.

## Error handling
- Missing binary / missing source / non-zero exit from ffmpeg or realesrgan →
  job set to `failed`, error logged.
- Temp directories always removed in `finally`.
- Atomic directory swap means a failed or interrupted run never leaves a corrupt
  or half-written HLS ladder; the previously playable version remains intact.
- Progress is advisory — if probing fails, the job still proceeds without
  per-segment percentages.

## Testing (vitest, node environment)
Mirror the existing approach: extract pure functions and unit-test those; gate the
spawn-heavy pipeline behind manual/integration runs (it needs the real binary and
GPU), matching how `transcode.ts` is structured today.
- HLS ladder → ffmpeg-args builder (pure).
- Segment-count and segment-progress → percent math (pure).
- Upscale-state UI decision helper (pure, like `progressDisplay`).

## Open questions
None. Target resolution, trigger model, hardware path, and codec are all settled.
