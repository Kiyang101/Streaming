# Change Video Thumbnail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users replace a VOD's thumbnail after upload — either by uploading a custom image or by grabbing a frame at a chosen timestamp — from both the watch page and the home-grid cards.

**Architecture:** A single `POST /api/videos/[id]/thumbnail` route handles both an `application/json` `{ timestamp }` frame-grab (ffmpeg over the retained original upload) and a `multipart` image upload (re-encoded to JPEG via ffmpeg). Each change writes a uniquely named `thumb-<ts>.jpg`, stores that path in the DB, and deletes the previous file, so the URL changes and the live-polling UI refreshes without a hard reload. A shared `ThumbnailEditor` modal drives both entry points.

**Tech Stack:** Next.js 15 (App Router, route handlers), React 19, better-sqlite3, ffmpeg (via `node:child_process`), Tailwind, vitest (node environment — UI logic is tested through exported pure helpers, not DOM renders).

---

### Task 1: Generalize ffmpeg frame extraction (`extractPosterAt`, `normalizeImageToJpeg`)

Replaces the hardcoded-1s `extractPoster` with a timestamped `extractPosterAt`, and adds image normalization. Both share one ffmpeg runner. Pure arg-builders are unit-tested; the runners get integration coverage against the existing sample fixture.

**Files:**
- Modify: `src/lib/transcode.ts:187-215` (replace `extractPoster`)
- Modify: `src/app/api/upload/route.ts:6` and `:43` (use `extractPosterAt`)
- Test: `tests/transcode.test.ts`

- [ ] **Step 1: Write failing arg-builder tests**

Add to `tests/transcode.test.ts` (update the import on line 2 to `import { transcodeToHls, extractPosterAt, normalizeImageToJpeg, posterArgs, imageArgs, probeDuration } from "@/lib/transcode";` and replace the existing `describe("extractPoster", ...)` block with the below):

```ts
describe("posterArgs", () => {
  it("seeks to the given second with a single output frame", () => {
    expect(posterArgs("in.mp4", "out.jpg", 12)).toEqual([
      "-ss", "12", "-i", "in.mp4", "-frames:v", "1", "-y", "out.jpg",
    ]);
  });
  it("preserves the 1s default used at upload time", () => {
    expect(posterArgs("in.mp4", "out.jpg", 1)[1]).toBe("1");
  });
});

describe("imageArgs", () => {
  it("re-encodes a single frame from the input image", () => {
    expect(imageArgs("in.png", "out.jpg")).toEqual([
      "-i", "in.png", "-frames:v", "1", "-y", "out.jpg",
    ]);
  });
});

describe("extractPosterAt", () => {
  it("writes a non-empty jpg at the requested timestamp", async () => {
    const outPath = path.join(posterDir, "thumb-at.jpg");
    await extractPosterAt("tests/fixtures/sample.mp4", outPath, 0);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    const outPath = path.join(posterDir, "missing-input.jpg");
    await expect(extractPosterAt("tests/fixtures/nope.mp4", outPath, 1)).rejects.toThrow();
  });
});

describe("normalizeImageToJpeg", () => {
  it("re-encodes an existing image to a non-empty jpg", async () => {
    const src = path.join(posterDir, "norm-src.jpg");
    await extractPosterAt("tests/fixtures/sample.mp4", src, 0);
    const out = path.join(posterDir, "norm-out.jpg");
    await normalizeImageToJpeg(src, out);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    await expect(normalizeImageToJpeg("tests/fixtures/nope.png", path.join(posterDir, "x.jpg"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/transcode.test.ts`
Expected: FAIL — `posterArgs`, `imageArgs`, `extractPosterAt`, `normalizeImageToJpeg` are not exported.

- [ ] **Step 3: Implement in `src/lib/transcode.ts`**

Replace the entire `extractPoster` function (lines 187-215) with:

```ts
/** Pure: ffmpeg args to grab a single frame at `seconds` into `out` as JPEG.
 *  `-ss` before `-i` is a fast (keyframe) seek — fine for a poster. */
export function posterArgs(input: string, out: string, seconds: number): string[] {
  return ["-ss", String(seconds), "-i", input, "-frames:v", "1", "-y", out];
}

/** Pure: ffmpeg args to re-encode any input image to a single JPEG frame. */
export function imageArgs(input: string, out: string): string[] {
  return ["-i", input, "-frames:v", "1", "-y", out];
}

/** Run ffmpeg to produce a single image file at `outPath`. Resolves on success,
 *  rejects on missing input or non-zero exit. Shared by the poster/image paths. */
function runFfmpegFrame(inputPath: string, outPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Extract a single poster frame at `seconds` into `outPath` (JPEG). */
export function extractPosterAt(inputPath: string, outPath: string, seconds: number): Promise<void> {
  return runFfmpegFrame(inputPath, outPath, posterArgs(inputPath, outPath, seconds));
}

/** Re-encode an uploaded image to a normalized JPEG at `outPath`. */
export function normalizeImageToJpeg(inputPath: string, outPath: string): Promise<void> {
  return runFfmpegFrame(inputPath, outPath, imageArgs(inputPath, outPath));
}
```

- [ ] **Step 4: Migrate the upload route to `extractPosterAt`**

In `src/app/api/upload/route.ts`, line 6, change the import:

```ts
import { transcodeToHls, extractPosterAt } from "@/lib/transcode";
```

And line 43, change the call (the upload-time poster stays at the ~1s frame):

```ts
        await extractPosterAt(savedPath, vodThumb(id), 1);
```

- [ ] **Step 5: Run the full suite to verify green**

Run: `npx vitest run tests/transcode.test.ts`
Expected: PASS (all `posterArgs`/`imageArgs`/`extractPosterAt`/`normalizeImageToJpeg` cases).

Run: `npx vitest run`
Expected: PASS — no other test references the removed `extractPoster`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/transcode.ts src/app/api/upload/route.ts tests/transcode.test.ts
git commit -m "feat: timestamped frame extraction + image normalization helpers"
```

---

### Task 2: Versioned thumbnail path helpers

Adds the unique-per-change path used by the route so changing a thumbnail busts the browser/poll cache.

**Files:**
- Modify: `src/lib/paths.ts` (after `vodThumbRel`, line 23)
- Test: `tests/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/paths.test.ts`:

```ts
import { vodThumbVersionedRel, vodThumbVersioned } from "@/lib/paths";
import path from "node:path";

describe("vodThumbVersionedRel", () => {
  it("builds a unique relative jpg path from id + timestamp", () => {
    expect(vodThumbVersionedRel("abc", 1717000000000)).toBe("vod/abc/thumb-1717000000000.jpg");
  });
});

describe("vodThumbVersioned", () => {
  it("resolves the versioned path under the media root", () => {
    const abs = vodThumbVersioned("abc", 42);
    expect(abs.endsWith(path.join("media", "vod", "abc", "thumb-42.jpg"))).toBe(true);
  });
});
```

(If `tests/paths.test.ts` lacks `describe`/`it`/`expect` imports, add `import { describe, it, expect } from "vitest";` at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement in `src/lib/paths.ts`** (insert after line 23, the close of `vodThumbRel`)

```ts
/** Absolute path to a uniquely-named thumbnail for a VOD (cache-busting). */
export function vodThumbVersioned(id: string, ts: number): string {
  return path.join(mediaRoot(), "vod", id, `thumb-${ts}.jpg`);
}
/** Relative (browser-URL) path to a uniquely-named VOD thumbnail. */
export function vodThumbVersionedRel(id: string, ts: number): string {
  return `vod/${id}/thumb-${ts}.jpg`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts tests/paths.test.ts
git commit -m "feat: versioned VOD thumbnail path helpers"
```

---

### Task 3: `POST /api/videos/[id]/thumbnail` route

Handles both request shapes, writes the new thumbnail, updates the DB, and cleans up the old file. Tests cover the guard branches (mirroring `tests/upscale-route.test.ts`, which keeps ffmpeg/media writes out of the test run).

**Files:**
- Create: `src/app/api/videos/[id]/thumbnail/route.ts`
- Test: `tests/thumbnail-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thumbnail-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { openDb, insertVideo } from "@/lib/db";
import { POST } from "@/app/api/videos/[id]/thumbnail/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function jsonReq(body: unknown) {
  return new NextRequest("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  openDb(":memory:");
});

describe("POST /api/videos/[id]/thumbnail", () => {
  it("404s for an unknown id", async () => {
    const res = await POST(jsonReq({ timestamp: 1 }), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("400s for a non-VOD video", async () => {
    insertVideo({ id: "l", title: "L", type: "live", status: "ready", path: "live/l/index.m3u8", createdAt: 1 });
    const res = await POST(jsonReq({ timestamp: 1 }), ctx("l"));
    expect(res.status).toBe(400);
  });

  it("400s for an invalid timestamp", async () => {
    insertVideo({ id: "v", title: "V", type: "vod", status: "ready", path: "vod/v/master.m3u8", createdAt: 1 });
    const res = await POST(jsonReq({ timestamp: -5 }), ctx("v"));
    expect(res.status).toBe(400);
  });

  it("404s for a frame-grab when the original source is missing", async () => {
    insertVideo({ id: "v2", title: "V2", type: "vod", status: "ready", path: "vod/v2/master.m3u8", createdAt: 1 });
    const res = await POST(jsonReq({ timestamp: 2 }), ctx("v2"));
    expect(res.status).toBe(404);
  });

  it("415s when a non-image file is uploaded", async () => {
    insertVideo({ id: "v3", title: "V3", type: "vod", status: "ready", path: "vod/v3/master.m3u8", createdAt: 1 });
    const form = new FormData();
    form.append("image", new File(["hello"], "note.txt", { type: "text/plain" }));
    const res = await POST(new NextRequest("http://x", { method: "POST", body: form }), ctx("v3"));
    expect(res.status).toBe(415);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thumbnail-route.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement `src/app/api/videos/[id]/thumbnail/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVideo, setThumbnail } from "@/lib/db";
import { mediaRoot, findUpload, vodThumbVersioned, vodThumbVersionedRel } from "@/lib/paths";
import { extractPosterAt, normalizeImageToJpeg } from "@/lib/transcode";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (video.type !== "vod") {
    return NextResponse.json({ error: "thumbnails are VOD-only" }, { status: 400 });
  }

  const ts = Date.now();
  const outAbs = vodThumbVersioned(id, ts);
  const outRel = vodThumbVersionedRel(id, ts);
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { timestamp?: unknown };
      const timestamp = Number(body.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        return NextResponse.json({ error: "invalid timestamp" }, { status: 400 });
      }
      const source = findUpload(id);
      if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });
      await extractPosterAt(source, outAbs, timestamp);
    } else {
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File) || !file.type.startsWith("image/")) {
        return NextResponse.json({ error: "expected an image file" }, { status: 415 });
      }
      const tmp = path.join(os.tmpdir(), `thumb-src-${ts}`);
      fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
      try {
        await normalizeImageToJpeg(tmp, outAbs);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
  } catch (err) {
    console.error(`thumbnail update failed for ${id}:`, err);
    return NextResponse.json({ error: "thumbnail processing failed" }, { status: 500 });
  }

  const previous = video.thumbnail;
  setThumbnail(id, outRel);

  // Best-effort cleanup of the prior thumbnail file; never fatal — the new
  // thumbnail is already committed to the DB.
  if (previous && previous !== outRel) {
    try {
      fs.rmSync(path.join(mediaRoot(), previous), { force: true });
    } catch (err) {
      console.error(`old thumbnail cleanup failed for ${id}:`, err);
    }
  }

  return NextResponse.json({ id, thumbnail: outRel });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thumbnail-route.test.ts`
Expected: PASS (all five guard cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/videos/[id]/thumbnail/route.ts tests/thumbnail-route.test.ts
git commit -m "feat: POST /api/videos/[id]/thumbnail (upload + frame-grab)"
```

---

### Task 4: Player exposes current playback time

Adds an optional callback so the watch-page editor can default the frame-grab timestamp to the current position. Minimal, regression-safe change to the player.

**Files:**
- Modify: `src/components/Player.tsx:54` (signature), `:254` (handler), `:271` and `:279` (listener wiring)

- [ ] **Step 1: Add the optional prop to the signature** (line 54)

Change:

```tsx
export default function Player({ src }: { src: string }) {
```
to:
```tsx
export default function Player({
  src,
  onTimeUpdate,
}: {
  src: string;
  onTimeUpdate?: (seconds: number) => void;
}) {
```

- [ ] **Step 2: Forward the time from the existing handler**

In the media-element effect, replace the local handler (line 254):

```tsx
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
```
with a renamed handler that also notifies the parent (renamed to avoid shadowing the new prop):
```tsx
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);
    };
```

Then update the two listener references that used `onTimeUpdate`:

- Line 271: `video.addEventListener("timeupdate", onTimeUpdate);` → `video.addEventListener("timeupdate", handleTimeUpdate);`
- Line 279: `video.removeEventListener("timeupdate", onTimeUpdate);` → `video.removeEventListener("timeupdate", handleTimeUpdate);`

(The effect keeps its `[]` deps: `onTimeUpdate` will be a stable `useState` setter from the parent.)

- [ ] **Step 3: Verify existing Player helper tests still pass**

Run: `npx vitest run tests/player-fill.test.ts`
Expected: PASS — exported pure helpers (`videoFitClass`, `parseFillMode`) are unchanged.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Player.tsx
git commit -m "feat: Player onTimeUpdate callback for current playback position"
```

---

### Task 5: `ThumbnailEditor` modal + `parseTimestamp` helper

Shared two-tab modal (Upload / From video). The `mm:ss` parser is an exported pure helper and is unit-tested; the modal itself is wired in the next two tasks.

**Files:**
- Create: `src/components/ThumbnailEditor.tsx`
- Test: `tests/thumbnail-editor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/thumbnail-editor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTimestamp } from "@/components/ThumbnailEditor";

describe("parseTimestamp", () => {
  it("parses plain seconds", () => {
    expect(parseTimestamp("90")).toBe(90);
  });
  it("parses mm:ss", () => {
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:05")).toBe(65);
  });
  it("trims surrounding whitespace", () => {
    expect(parseTimestamp("  2:00 ")).toBe(120);
  });
  it("returns null for empty or non-numeric input", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
  });
  it("returns null for more than two segments", () => {
    expect(parseTimestamp("1:2:3")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/thumbnail-editor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/components/ThumbnailEditor.tsx`**

```tsx
"use client";
import { useState } from "react";
import type { Video } from "@/lib/types";

/** Parse a "mm:ss" or plain-seconds string into a non-negative second count.
 *  Returns null for empty / non-numeric / >2-segment input. Pure (unit-tested). */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 2) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds;
}

type Tab = "upload" | "frame";

/** Modal for replacing a VOD's thumbnail, by image upload or by frame-grab.
 *  `defaultTimestamp` (seconds) pre-fills the frame tab from the watch player. */
export default function ThumbnailEditor({
  video,
  defaultTimestamp,
  onClose,
  onChanged,
}: {
  video: Video;
  defaultTimestamp?: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [tsText, setTsText] = useState(
    defaultTimestamp != null ? String(Math.floor(defaultTimestamp)) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(makeRequest: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await makeRequest();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update thumbnail.");
        return;
      }
      onChanged?.();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submitUpload() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    const form = new FormData();
    form.append("image", file);
    void send(() => fetch(`/api/videos/${video.id}/thumbnail`, { method: "POST", body: form }));
  }

  function submitFrame() {
    const seconds = parseTimestamp(tsText);
    if (seconds == null) {
      setError("Enter a time like 1:30 or 90.");
      return;
    }
    void send(() =>
      fetch(`/api/videos/${video.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: seconds }),
      }),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Change thumbnail"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-yt-surface p-5 text-yt-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Change thumbnail</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-yt-subtext hover:text-yt-text">
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`rounded-full px-3 py-1 text-sm ${tab === "upload" ? "bg-yt-red text-white" : "bg-yt-bg text-yt-subtext"}`}
          >
            Upload image
          </button>
          <button
            type="button"
            onClick={() => setTab("frame")}
            className={`rounded-full px-3 py-1 text-sm ${tab === "frame" ? "bg-yt-red text-white" : "bg-yt-bg text-yt-subtext"}`}
          >
            From video
          </button>
        </div>

        {tab === "upload" ? (
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-yt-subtext"
            />
            <button
              type="button"
              onClick={submitUpload}
              disabled={busy}
              className="rounded-full bg-yt-red px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save thumbnail"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm text-yt-subtext">
              Timestamp (mm:ss or seconds)
              <input
                type="text"
                value={tsText}
                onChange={(e) => setTsText(e.target.value)}
                placeholder="1:30"
                className="mt-1 block w-full rounded-md bg-yt-bg px-3 py-1.5 text-sm text-yt-text outline-none"
              />
            </label>
            <button
              type="button"
              onClick={submitFrame}
              disabled={busy}
              className="rounded-full bg-yt-red px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Use this frame"}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-yt-red">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/thumbnail-editor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ThumbnailEditor.tsx tests/thumbnail-editor.test.ts
git commit -m "feat: ThumbnailEditor modal + mm:ss timestamp parser"
```

---

### Task 6: Wire the editor into `VideoCard`

Adds a "Change thumbnail" action to VOD cards. The modal renders as a sibling of the card link (not inside it) so opening it never triggers navigation.

**Files:**
- Modify: `src/components/VideoCard.tsx` (imports at line 1-4; default export at lines 227-260)

- [ ] **Step 1: Add imports**

At the top of `src/components/VideoCard.tsx`, add to the existing imports:

```tsx
import ThumbnailEditor from "@/components/ThumbnailEditor";
```

(`useState` is already imported on line 3.)

- [ ] **Step 2: Add a change-thumbnail control inside the card body**

In the `body` JSX (lines 228-240), add the button after `<UpscaleControl ... />` (only for VOD). The new control:

```tsx
      {video.type === "vod" && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault(); // don't follow the card's watch link
            e.stopPropagation();
            setEditing(true);
          }}
          className="mt-2 ml-2 rounded-full border border-yt-surface px-3 py-1 text-xs font-medium text-yt-text transition-colors hover:bg-yt-surface"
        >
          Change thumbnail
        </button>
      )}
```

- [ ] **Step 3: Manage modal state and render it as a sibling of the link**

Replace the default export (lines 227-260) so it holds `editing` state and renders the modal outside the `<Link>`/`<div>`:

```tsx
export default function VideoCard({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const [editing, setEditing] = useState(false);

  const body = (
    <>
      <Thumbnail video={video} />
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-yt-text">{video.title}</h3>
        <StatusBadge status={video.status} />
      </div>
      <ProgressBar video={video} />
      <UpscaleControl video={video} onChanged={onChanged} />
      {video.type === "vod" && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="mt-2 ml-2 rounded-full border border-yt-surface px-3 py-1 text-xs font-medium text-yt-text transition-colors hover:bg-yt-surface"
        >
          Change thumbnail
        </button>
      )}
    </>
  );

  const card =
    video.status === "ready" ? (
      <Link
        href={`/watch/${video.id}`}
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-yt-red"
        aria-label={`Watch ${video.title}`}
      >
        {body}
      </Link>
    ) : (
      <div className="block rounded-xl opacity-90" aria-label={`${video.title} (${video.status})`}>
        {body}
      </div>
    );

  return (
    <>
      {card}
      {editing && (
        <ThumbnailEditor
          video={video}
          onClose={() => setEditing(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS (existing `tests/video-card-*.test.ts` test pure helpers, which are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/VideoCard.tsx
git commit -m "feat: change-thumbnail action on VOD cards"
```

---

### Task 7: Wire the editor into the watch page

Adds an "Edit thumbnail" button under the player; the frame tab defaults to the current playback position. A small client wrapper holds the player time and modal state so the watch page stays a server component.

**Files:**
- Create: `src/components/WatchPlayer.tsx`
- Modify: `src/app/watch/[id]/page.tsx:1` (import) and `:52` (render)

- [ ] **Step 1: Create `src/components/WatchPlayer.tsx`**

```tsx
"use client";
import { useState } from "react";
import Player from "@/components/Player";
import ThumbnailEditor from "@/components/ThumbnailEditor";
import type { Video } from "@/lib/types";

/** Watch-page player wrapper: tracks current playback time and hosts the
 *  thumbnail editor so the frame tab can default to the current position. */
export default function WatchPlayer({ video }: { video: Video }) {
  const [editing, setEditing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <>
      <Player src={`/media/${video.path}`} onTimeUpdate={setCurrentTime} />
      {video.type === "vod" && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 rounded-full border border-yt-surface px-3 py-1 text-sm font-medium text-yt-text transition-colors hover:bg-yt-surface"
        >
          Edit thumbnail
        </button>
      )}
      {editing && (
        <ThumbnailEditor
          video={video}
          defaultTimestamp={currentTime}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Use the wrapper on the watch page**

In `src/app/watch/[id]/page.tsx`, replace the `Player` import (line 1):

```tsx
import WatchPlayer from "@/components/WatchPlayer";
```

And replace the player render (line 52, `<Player src={`/media/${video.path}`} />`):

```tsx
          <WatchPlayer video={video} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (dev server)**

Run the dev server, open a ready VOD's watch page, click **Edit thumbnail**, and confirm:
- "From video" tab pre-fills a timestamp from the current position; "Use this frame" updates the poster (visible on the home grid within the 4s poll).
- "Upload image" replaces the poster with a chosen image.
- The same flow works from a card's **Change thumbnail** button.

- [ ] **Step 5: Commit**

```bash
git add src/components/WatchPlayer.tsx src/app/watch/[id]/page.tsx
git commit -m "feat: edit-thumbnail button on the watch page"
```

---

## Self-Review Notes

- **Spec coverage:** upload-image source (Task 3 multipart + Task 5 upload tab); frame-grab source (Task 3 JSON + Task 5 frame tab); both entry points (Task 6 card, Task 7 watch); versioned-filename cache-busting (Task 2 + Task 3); ffmpeg generalization (Task 1); error handling — 404/400/415/500, best-effort cleanup (Task 3). All spec sections map to a task.
- **Type/name consistency:** `extractPosterAt`, `normalizeImageToJpeg`, `posterArgs`, `imageArgs` (Task 1) reused verbatim in Task 3; `vodThumbVersioned`/`vodThumbVersionedRel` (Task 2) reused in Task 3; `parseTimestamp` (Task 5) used in Task 5 UI; `onTimeUpdate` prop (Task 4) consumed in Task 7; `ThumbnailEditor` props (`video`, `defaultTimestamp`, `onClose`, `onChanged`) match both call sites.
- **No placeholders:** every code step contains complete, copy-pasteable content.
