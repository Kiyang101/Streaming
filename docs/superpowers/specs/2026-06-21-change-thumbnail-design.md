# Change Video Thumbnail — Design

**Date:** 2026-06-21
**Status:** Approved (brainstorming)

## Summary

Let users replace a VOD's thumbnail after upload, either by **uploading a custom
image** or by **grabbing a frame from the video**. Available from both the watch
page and the home-grid video cards.

Today the thumbnail is set once at upload time: `extractPoster` grabs the frame
~1s in, writes `media/vod/<id>/thumb.jpg`, and stores the relative path
`vod/<id>/thumb.jpg` in the DB `thumbnail` column. `VideoCard` renders
`/media/<thumbnail>` or a gradient placeholder. This feature adds a way to change
that value later.

## Goals

- Replace a video's thumbnail from an uploaded image (JPG/PNG/WebP).
- Replace a video's thumbnail from a chosen frame (timestamp in seconds) of the
  original source.
- Trigger from the watch page (timestamp defaults to current playback position)
  and from the home-grid card (typed `mm:ss` timestamp).
- New thumbnail propagates to all clients on the next poll without a hard reload.

## Non-goals (YAGNI)

- Live frame preview before saving (save-and-see is the loop).
- Multiple thumbnails / galleries.
- Crop / drag / aspect adjustment.
- Changing thumbnails for live streams (VOD only).

## Architecture

### Cache invalidation — versioned filename

Overwriting `thumb.jpg` leaves the `<img src>` unchanged, so the live-polling
grid and already-painted images keep showing the stale picture. Instead, each
change writes a uniquely named file and stores its full relative path in the DB:

- Write `media/vod/<id>/thumb-<timestamp>.jpg`.
- `setThumbnail(id, "vod/<id>/thumb-<timestamp>.jpg")`.
- Delete the previous thumb file (best-effort; failure is logged, not fatal).

Because the URL changes, every client refreshes naturally on the next 4s poll.
The DB `thumbnail` value stays a clean path (no query strings).

### Backend

**Route:** `POST /api/videos/[id]/thumbnail`

Accepts two request shapes:

1. **multipart/form-data** with an `image` file
   - Reject if the file's type is not `image/*` → `415`.
   - Save the upload to a temp path, re-encode to JPEG via
     `normalizeImageToJpeg` into `thumb-<ts>.jpg` (normalizes format/dimensions,
     strips metadata).
2. **application/json** `{ timestamp: <number, seconds> }`
   - `source = findUpload(id)`; if absent → `404` ("source not found").
   - Reject non-finite / negative timestamp → `400`.
   - `extractPosterAt(source, thumb-<ts>.jpg, timestamp)`.

Common flow on success:
- `setThumbnail(id, newRelPath)`
- delete old thumb file (best-effort)
- `200` → `{ id, thumbnail: newRelPath }`

Guards (checked first): `getVideo(id)` missing → `404`; video `type !== "vod"`
→ `400`.

**`src/lib/transcode.ts`:**
- Generalize `extractPoster(input, out)` → `extractPosterAt(input, out, seconds)`.
  The upload route's existing call becomes `extractPosterAt(src, out, 1)`.
  ffmpeg args: `["-ss", <hms>, "-i", input, "-frames:v", "1", "-y", out]`.
- Add `normalizeImageToJpeg(inPath, outPath)`: `["-i", inPath, "-frames:v", "1",
  "-y", outPath]` (re-encodes any input image to a single JPEG frame).

**`src/lib/paths.ts`:**
- Add a helper for the versioned thumb path, e.g.
  `vodThumbVersioned(id, ts)` → absolute, and `vodThumbVersionedRel(id, ts)` →
  relative. Keep `vodThumb`/`vodThumbRel` for the upload-time default, or migrate
  the upload route to the versioned scheme for consistency (preferred).

`setThumbnail` already exists in `db.ts` and is reused as-is.

### Frontend

**`src/components/ThumbnailEditor.tsx`** (new, client component) — a modal with
two tabs:
- **Upload:** file input (`accept="image/*"`) → multipart POST.
- **From video:** numeric timestamp. On the watch page it pre-fills from the
  player's current position with a "use current position" action; on the card it
  is a `mm:ss` text input. → JSON POST.

On success the editor closes; the home grid's existing 4s poll picks up the new
path. The watch page re-fetches or updates local state.

**Watch page (`src/app/watch/[id]/page.tsx` + Player):** add an "Edit thumbnail"
button. The Player exposes its current `currentTime` (pure helper or callback) so
the editor can default the timestamp.

**`src/components/VideoCard.tsx`:** add a hover action ("Change thumbnail") that
opens the editor for that video. No player present, so the "From video" tab uses
a typed `mm:ss` timestamp.

## Error handling

- Missing video → `404`; non-VOD → `400`.
- Non-image upload → `415`; invalid/negative timestamp → `400`.
- Frame-grab with no retained source → `404`.
- ffmpeg failure → `500` with logged stderr; DB thumbnail unchanged.
- Old-file deletion failure → logged, non-fatal (new thumbnail already committed).

## Testing

Mirrors existing `upscale-route` / `transcode` test patterns:
- `extractPosterAt` builds correct ffmpeg args for a given timestamp (incl. the
  `1` default preserves prior behavior).
- `normalizeImageToJpeg` builds correct args.
- Versioned-filename helper produces a unique, well-formed relative path.
- Route: image-upload success updates DB thumbnail; timestamp-grab success;
  non-image rejected `415`; missing video `404`; non-VOD `400`.

## Affected files

- `src/app/api/videos/[id]/thumbnail/route.ts` (new)
- `src/lib/transcode.ts` (`extractPosterAt`, `normalizeImageToJpeg`)
- `src/lib/paths.ts` (versioned thumb helpers)
- `src/app/api/upload/route.ts` (use `extractPosterAt(..., 1)`)
- `src/components/ThumbnailEditor.tsx` (new)
- `src/components/VideoCard.tsx` (open editor)
- `src/app/watch/[id]/page.tsx` + `src/components/Player.tsx` (button + current time)
- `tests/` (new unit + route tests)
