# 4K AI Upscaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in "Upscale to 4K" action that AI-upscales a VOD's original file with `realesrgan-ncnn-vulkan` and rebuilds its HLS ladder with a real 2160p rendition.

**Architecture:** A background job splits the original upload into ~15s segments, upscales each segment's frames ×4 on the GPU (Metal/Vulkan), re-encodes to 3840×2160, concatenates them into a 4K master, runs the existing HLS transcode with a 4K ladder, and atomically swaps the result into the VOD directory. State and progress live in two new SQLite columns and surface on the video card.

**Tech Stack:** Next.js 15 (App Router), TypeScript, better-sqlite3, ffmpeg/ffprobe, realesrgan-ncnn-vulkan, vitest (node environment).

---

## File Structure

**Create:**
- `src/lib/upscale.ts` — upscale pipeline orchestration + pure helpers (`segmentCount`, `upscalePercent`).
- `src/lib/upscaleLock.ts` — module-level single-job lock.
- `src/lib/upscaleEligibility.ts` — pure request-eligibility decision.
- `src/app/api/videos/[id]/upscale/route.ts` — POST endpoint that starts the job.
- `tests/upscale-helpers.test.ts`, `tests/upscale-lock.test.ts`, `tests/upscale-eligibility.test.ts`, `tests/hls-ladder.test.ts`, `tests/video-card-upscale.test.ts`, `tests/upscale-pipeline.test.ts`.

**Modify:**
- `src/lib/types.ts` — add `UpscaleStatus` + two `Video` fields.
- `src/lib/db.ts` — migrations + `setUpscaleStatus`, `setUpscaleProgress`.
- `src/lib/paths.ts` — `uploadsDir`, `findUpload`, `matchUploadFile`.
- `src/lib/transcode.ts` — parametrize `transcodeToHls` by a ladder spec; export `Rendition`, `DEFAULT_LADDER`, `UHD_LADDER`, `buildHlsArgs`.
- `src/components/VideoCard.tsx` — `upscaleAction` helper + button/badge/progress UI.
- `src/app/page.tsx` — pass `onChanged` to cards; keep fast poll while upscaling.
- `README.md` — install/config notes.

---

## Task 1: Data model — upscale status & progress columns

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Test: `tests/db.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/db.test.ts`:

```ts
import { openDb, insertVideo, getVideo, setUpscaleStatus, setUpscaleProgress } from "@/lib/db";

describe("upscale columns", () => {
  it("default to null/undefined on insert", () => {
    insertVideo({ id: "u", title: "U", type: "vod", status: "ready", path: "vod/u/master.m3u8", createdAt: 1 });
    const v = getVideo("u");
    expect(v?.upscaleStatus == null).toBe(true);
    expect(v?.upscaleProgress == null).toBe(true);
  });

  it("persist via setUpscaleStatus and setUpscaleProgress", () => {
    insertVideo({ id: "u", title: "U", type: "vod", status: "ready", path: "vod/u/master.m3u8", createdAt: 1 });
    setUpscaleStatus("u", "upscaling");
    setUpscaleProgress("u", 37);
    const v = getVideo("u");
    expect(v?.upscaleStatus).toBe("upscaling");
    expect(v?.upscaleProgress).toBe(37);
  });
});
```

Note: `tests/db.test.ts` already has a top-level `import ... from "@/lib/db"` and a `beforeEach(() => openDb(":memory:"))`. Merge the new symbols into the existing import line rather than adding a duplicate import, and place this `describe` inside the existing file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `setUpscaleStatus`/`setUpscaleProgress` are not exported.

- [ ] **Step 3: Add the type**

In `src/lib/types.ts`, add the union near `VideoStatus` and two optional fields to `Video`:

```ts
export type UpscaleStatus = "none" | "upscaling" | "upscaled" | "failed";
```

Inside `interface Video`, after `progress?: number;`:

```ts
  upscaleStatus?: UpscaleStatus; // null until an upscale is requested
  upscaleProgress?: number; // whole-number percent (0–100) during upscaling
```

- [ ] **Step 4: Add columns + helpers**

In `src/lib/db.ts`, update the import:

```ts
import type { Video, VideoStatus, UpscaleStatus } from "./types";
```

After the existing `progress` migration `try/catch` block in `openDb`, add:

```ts
  // Migrate pre-existing DBs that lack the upscale columns.
  try {
    db.exec(`ALTER TABLE videos ADD COLUMN upscaleStatus TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE videos ADD COLUMN upscaleProgress INTEGER`);
  } catch {}
```

At the end of the file, add:

```ts
export function setUpscaleStatus(id: string, status: UpscaleStatus): void {
  conn().prepare(`UPDATE videos SET upscaleStatus = ? WHERE id = ?`).run(status, id);
}

export function setUpscaleProgress(id: string, percent: number): void {
  conn().prepare(`UPDATE videos SET upscaleProgress = ? WHERE id = ?`).run(percent, id);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/db.ts tests/db.test.ts
git commit -m "feat: add upscale status/progress columns and db helpers"
```

---

## Task 2: paths — locate the original upload + temp scratch dir

**Files:**
- Modify: `src/lib/paths.ts`
- Test: `tests/paths.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/paths.test.ts` (merge `matchUploadFile`, `upscaleTmpDir`, `uploadsDir` into the existing `@/lib/paths` import line):

```ts
import { matchUploadFile, uploadsDir } from "@/lib/paths";

describe("matchUploadFile", () => {
  it("returns the filename whose stem equals the id", () => {
    expect(matchUploadFile(["abc.mp4", "def.mov"], "abc")).toBe("abc.mp4");
    expect(matchUploadFile(["abc.mkv", "abcd.mp4"], "abc")).toBe("abc.mkv");
  });
  it("returns null when no file matches the id stem", () => {
    expect(matchUploadFile(["abcd.mp4", "xyz.mov"], "abc")).toBeNull();
  });
});

describe("uploadsDir", () => {
  it("is media/uploads", () => {
    expect(uploadsDir()).toBe(path.join(mediaRoot(), "uploads"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paths.test.ts`
Expected: FAIL — `matchUploadFile`/`upscaleTmpDir`/`uploadsDir` not exported.

- [ ] **Step 3: Implement**

In `src/lib/paths.ts`, add `import fs from "node:fs";` at the top (alongside the existing `path` import), then add:

```ts
export function uploadsDir(): string {
  return path.join(mediaRoot(), "uploads");
}

/**
 * Pure: given a list of filenames and an id, return the one whose stem (name
 * without extension) equals the id, else null. The upload route saves the
 * original as `<id>.<ext>`, so the stem uniquely identifies it.
 */
export function matchUploadFile(filenames: string[], id: string): string | null {
  for (const name of filenames) {
    const dot = name.lastIndexOf(".");
    const stem = dot === -1 ? name : name.slice(0, dot);
    if (stem === id) return name;
  }
  return null;
}

/** Absolute path to the original uploaded source for a video id, or null. */
export function findUpload(id: string): string | null {
  const dir = uploadsDir();
  if (!fs.existsSync(dir)) return null;
  const match = matchUploadFile(fs.readdirSync(dir), id);
  return match ? path.join(dir, match) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts tests/paths.test.ts
git commit -m "feat: add findUpload/matchUploadFile and upscale temp-dir paths"
```

---

## Task 3: Parametrize the HLS ladder

**Files:**
- Modify: `src/lib/transcode.ts`
- Test: `tests/hls-ladder.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/hls-ladder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHlsArgs, DEFAULT_LADDER, UHD_LADDER } from "@/lib/transcode";
import path from "node:path";

describe("buildHlsArgs", () => {
  it("reproduces the original 720p/480p args for the default ladder", () => {
    const out = "/tmp/out";
    expect(buildHlsArgs("in.mp4", out, DEFAULT_LADDER)).toEqual([
      "-y",
      "-i", "in.mp4",
      "-filter_complex", "[0:v]split=2[v0][v1];[v0]scale=w=1280:h=720[v0out];[v1]scale=w=854:h=480[v1out]",
      "-map", "[v0out]", "-c:v:0", "libx264", "-b:v:0", "2800k",
      "-map", "[v1out]", "-c:v:1", "libx264", "-b:v:1", "1400k",
      "-map", "a:0?", "-map", "a:0?", "-c:a", "aac", "-b:a", "128k",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(out, "v%v_%03d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", "v:0,a:0 v:1,a:1",
      path.join(out, "v%v.m3u8"),
    ]);
  });

  it("builds a 3-rendition var_stream_map and split for the UHD ladder", () => {
    const args = buildHlsArgs("in.mp4", "/tmp/out", UHD_LADDER);
    expect(args).toContain("[0:v]split=3[v0][v1][v2];[v0]scale=w=3840:h=2160[v0out];[v1]scale=w=1920:h=1080[v1out];[v2]scale=w=1280:h=720[v2out]");
    expect(args).toContain("v:0,a:0 v:1,a:1 v:2,a:2");
    expect(args).toContain("-b:v:0");
    expect(args).toContain("16000k");
  });

  it("exposes a UHD ladder topping out at 2160p", () => {
    expect(UHD_LADDER[0]).toEqual({ width: 3840, height: 2160, bitrate: "16000k" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hls-ladder.test.ts`
Expected: FAIL — `buildHlsArgs`/`DEFAULT_LADDER`/`UHD_LADDER` not exported.

- [ ] **Step 3: Implement the builder and refactor `transcodeToHls`**

In `src/lib/transcode.ts`, add near the top (after imports):

```ts
export interface Rendition {
  width: number;
  height: number;
  bitrate: string; // ffmpeg bitrate string, e.g. "2800k"
}

export const DEFAULT_LADDER: Rendition[] = [
  { width: 1280, height: 720, bitrate: "2800k" },
  { width: 854, height: 480, bitrate: "1400k" },
];

export const UHD_LADDER: Rendition[] = [
  { width: 3840, height: 2160, bitrate: "16000k" },
  { width: 1920, height: 1080, bitrate: "5000k" },
  { width: 1280, height: 720, bitrate: "2800k" },
];

/**
 * Build the ffmpeg argument list that produces an HLS ABR ladder from the given
 * renditions. Pure (no I/O) so it can be unit-tested. The default ladder
 * reproduces the original hardcoded 720p/480p command exactly.
 */
export function buildHlsArgs(inputPath: string, outDir: string, ladder: Rendition[]): string[] {
  const n = ladder.length;
  const labels = ladder.map((_, i) => `[v${i}]`).join("");
  const scales = ladder
    .map((r, i) => `[v${i}]scale=w=${r.width}:h=${r.height}[v${i}out]`)
    .join(";");
  const filterComplex = `[0:v]split=${n}${labels};${scales}`;

  const videoMaps: string[] = [];
  for (let i = 0; i < n; i++) {
    videoMaps.push("-map", `[v${i}out]`, `-c:v:${i}`, "libx264", `-b:v:${i}`, ladder[i].bitrate);
  }

  const audioMaps: string[] = [];
  for (let i = 0; i < n; i++) audioMaps.push("-map", "a:0?");
  audioMaps.push("-c:a", "aac", "-b:a", "128k");

  const varStreamMap = ladder.map((_, i) => `v:${i},a:${i}`).join(" ");

  return [
    "-y",
    "-i", inputPath,
    "-filter_complex", filterComplex,
    ...videoMaps,
    ...audioMaps,
    "-f", "hls",
    "-hls_time", "4",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", path.join(outDir, "v%v_%03d.ts"),
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", varStreamMap,
    path.join(outDir, "v%v.m3u8"),
  ];
}
```

Now change `transcodeToHls`'s signature and body to use the builder. Replace the signature:

```ts
export function transcodeToHls(
  inputPath: string,
  outDir: string,
  onProgress?: (percent: number) => void,
  ladder: Rendition[] = DEFAULT_LADDER,
): Promise<void> {
```

Inside the body, delete the hardcoded `const args = [ ... ];` block and replace it with:

```ts
    const args = buildHlsArgs(inputPath, outDir, ladder);
```

Leave the rest of the function (the `run`, progress parsing, and probe logic) unchanged — it already mutates `args` only via `args.unshift("-progress", "pipe:1")`.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run tests/hls-ladder.test.ts tests/transcode.test.ts`
Expected: PASS — the builder test passes and the existing real-ffmpeg `transcode.test.ts` still produces a master playlist (the default ladder is byte-for-byte identical).

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcode.ts tests/hls-ladder.test.ts
git commit -m "feat: parametrize HLS transcode by a rendition ladder (DEFAULT + UHD)"
```

---

## Task 4: Upscale pure helpers (segment math + progress)

**Files:**
- Create: `src/lib/upscale.ts`
- Test: `tests/upscale-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/upscale-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentCount, upscalePercent, SEGMENT_SECONDS } from "@/lib/upscale";

describe("segmentCount", () => {
  it("ceils duration/segmentSeconds", () => {
    expect(segmentCount(30, 15)).toBe(2);
    expect(segmentCount(31, 15)).toBe(3);
  });
  it("is at least 1 even for tiny/zero durations", () => {
    expect(segmentCount(0, 15)).toBe(1);
    expect(segmentCount(2, 15)).toBe(1);
  });
  it("defaults to SEGMENT_SECONDS", () => {
    expect(segmentCount(SEGMENT_SECONDS * 3)).toBe(3);
  });
});

describe("upscalePercent", () => {
  it("maps segments-done to a percent capped at 99", () => {
    expect(upscalePercent(0, 4)).toBe(0);
    expect(upscalePercent(2, 4)).toBe(50);
    expect(upscalePercent(4, 4)).toBe(99); // 100 is emitted only after HLS completes
  });
  it("returns 0 for non-positive totals", () => {
    expect(upscalePercent(1, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/upscale-helpers.test.ts`
Expected: FAIL — `@/lib/upscale` does not exist.

- [ ] **Step 3: Implement helpers**

Create `src/lib/upscale.ts` with ONLY the pure helpers for now (the pipeline lands in Task 5):

```ts
export const SEGMENT_SECONDS = 15;

/** Number of fixed-length segments a video of `durationSeconds` splits into. */
export function segmentCount(durationSeconds: number, segmentSeconds = SEGMENT_SECONDS): number {
  return Math.max(1, Math.ceil(durationSeconds / segmentSeconds));
}

/**
 * Segment-granularity progress for the upscale (frame) phase, capped at 99 so
 * the final 100 is reserved for after the HLS transcode finishes.
 */
export function upscalePercent(segmentsDone: number, totalSegments: number): number {
  if (totalSegments <= 0) return 0;
  return Math.min(99, Math.round((segmentsDone / totalSegments) * 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/upscale-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/upscale.ts tests/upscale-helpers.test.ts
git commit -m "feat: upscale segment-count and progress helpers"
```

---

## Task 5: Upscale pipeline (`upscaleVideoToHls`)

**Files:**
- Modify: `src/lib/upscale.ts`
- Test: `tests/upscale-pipeline.test.ts`

This task adds the GPU/ffmpeg pipeline. It is verified by a real integration test that **skips automatically when `realesrgan-ncnn-vulkan` is not installed** (mirroring how `transcode.test.ts` uses real ffmpeg).

- [ ] **Step 1: Write the (skip-aware) integration test**

Create `tests/upscale-pipeline.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { upscaleVideoToHls } from "@/lib/upscale";

function hasRealesrgan(): boolean {
  const bin = process.env.REALESRGAN_PATH || "realesrgan-ncnn-vulkan";
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "upscale-out-"));
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe("upscaleVideoToHls", () => {
  it("rejects when the input file does not exist", async () => {
    await expect(upscaleVideoToHls("tests/fixtures/nope.mp4", outDir)).rejects.toThrow();
  });

  it.skipIf(!hasRealesrgan())(
    "produces a 4K master playlist from the sample and reports progress ending at 100",
    async () => {
      const progress: number[] = [];
      await upscaleVideoToHls("tests/fixtures/sample.mp4", outDir, (p) => progress.push(p));
      expect(fs.existsSync(path.join(outDir, "master.m3u8"))).toBe(true);
      expect(progress[progress.length - 1]).toBe(100);
      const master = fs.readFileSync(path.join(outDir, "master.m3u8"), "utf8");
      expect(master).toContain("RESOLUTION=3840x2160");
    },
    600_000,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/upscale-pipeline.test.ts`
Expected: FAIL — `upscaleVideoToHls` is not exported (the "rejects" test errors on the missing import; the heavy test skips unless the binary is present).

- [ ] **Step 3: Implement the pipeline**

Append to `src/lib/upscale.ts`. First add imports at the very top of the file:

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { probeDuration, transcodeToHls, UHD_LADDER } from "./transcode";
```

Then append the implementation below the existing helpers:

```ts
const REALESRGAN = process.env.REALESRGAN_PATH || "realesrgan-ncnn-vulkan";
const REALESRGAN_MODEL = process.env.REALESRGAN_MODEL || "realesrgan-x4plus";

/** Run a child process to completion; reject on error / non-zero exit. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Probe a video's average frame rate as a number (e.g. 24, 29.97). */
function probeFps(input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate",
      "-of", "default=nw=1:nk=1",
      input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe fps exited ${code}`));
      const [num, den] = out.trim().split("/");
      const fps = Number(num) / (Number(den) || 1);
      resolve(Number.isFinite(fps) && fps > 0 ? fps : 24);
    });
  });
}

/**
 * AI-upscale `inputPath` to a 4K HLS ladder written to `outDir`.
 *
 * Pipeline: split into ~15s segments → per segment {extract PNG frames →
 * realesrgan ×4 → reassemble at 3840×2160} → concat to a 4K master → HLS
 * transcode (UHD ladder). All scratch work happens in a sibling temp dir on the
 * SAME filesystem as `outDir`; the finished ladder is built in a staging dir and
 * atomically renamed into `outDir` so playback never observes a partial result
 * (and the existing playable ladder in `outDir` is left untouched until the
 * swap). Progress is segment-granular (0–99), with 100 emitted once the HLS
 * transcode completes.
 */
export async function upscaleVideoToHls(
  inputPath: string,
  outDir: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!fs.existsSync(inputPath)) throw new Error(`input not found: ${inputPath}`);

  // Scratch dir is a sibling of outDir (e.g. media/vod/.tmp-<id>) so the final
  // rename into outDir is a same-filesystem, atomic operation.
  const work = path.join(path.dirname(outDir), `.tmp-${path.basename(outDir)}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const segIn = path.join(work, "segin");
  const segOut = path.join(work, "segout");
  fs.mkdirSync(segIn, { recursive: true });
  fs.mkdirSync(segOut, { recursive: true });

  try {
    const duration = await probeDuration(inputPath).catch(() => 0);
    const total = segmentCount(duration);

    // 1) Split source into ~15s segments (stream copy: fast, splits on keyframes).
    await run("ffmpeg", [
      "-y", "-i", inputPath,
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(SEGMENT_SECONDS),
      "-reset_timestamps", "1",
      path.join(segIn, "seg_%03d.mp4"),
    ]);

    const segFiles = fs.readdirSync(segIn).filter((f) => f.endsWith(".mp4")).sort();
    onProgress?.(0);

    // 2) Upscale each segment, deleting its frames before moving on (bounds disk).
    for (let i = 0; i < segFiles.length; i++) {
      const seg = path.join(segIn, segFiles[i]);
      const frames = path.join(work, `frames_${i}`);
      const upFrames = path.join(work, `up_${i}`);
      fs.mkdirSync(frames, { recursive: true });
      fs.mkdirSync(upFrames, { recursive: true });

      const fps = await probeFps(seg);

      // Extract frames as PNG.
      await run("ffmpeg", ["-y", "-i", seg, path.join(frames, "%06d.png")]);

      // Real-ESRGAN ×4 over the whole frames directory.
      const esrganArgs = ["-i", frames, "-o", upFrames, "-n", REALESRGAN_MODEL, "-s", "4"];
      if (process.env.REALESRGAN_MODELS) esrganArgs.push("-m", process.env.REALESRGAN_MODELS);
      await run(REALESRGAN, esrganArgs);

      // Reassemble upscaled frames → 3840×2160, muxing the segment's own audio.
      await run("ffmpeg", [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(upFrames, "%06d.png"),
        "-i", seg,
        "-map", "0:v", "-map", "1:a?",
        "-vf", "scale=3840:2160:flags=lanczos",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        path.join(segOut, `up_${String(i).padStart(3, "0")}.mp4`),
      ]);

      // Free this segment's frames before the next iteration.
      fs.rmSync(frames, { recursive: true, force: true });
      fs.rmSync(upFrames, { recursive: true, force: true });

      onProgress?.(upscalePercent(i + 1, total));
    }

    // 3) Concat upscaled segments into a single 4K master.
    const upSegs = fs.readdirSync(segOut).filter((f) => f.endsWith(".mp4")).sort();
    const listFile = path.join(work, "concat.txt");
    fs.writeFileSync(listFile, upSegs.map((f) => `file '${path.join(segOut, f)}'`).join("\n"));
    const master4k = path.join(work, "master4k.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", master4k]);

    // 4) HLS transcode with the UHD ladder into a staging dir.
    const staging = path.join(work, "hls");
    await transcodeToHls(master4k, staging, undefined, UHD_LADDER);

    // 5) Atomically replace outDir with the staged ladder. staging is inside
    //    `work`, a sibling of outDir on the same filesystem, so rename is atomic.
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(staging, outDir);

    onProgress?.(100);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
```

> Note: because `staging` lives inside `work` (a sibling of `outDir` on the same filesystem), `renameSync` is a true atomic rename — no cross-filesystem `EXDEV` fallback is needed. The `finally` cleans up `work`; once `staging` has been renamed out of it, only frame/segment scratch remains to delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/upscale-pipeline.test.ts`
Expected: PASS — the "rejects on missing input" test passes; the heavy test passes if `realesrgan-ncnn-vulkan` is installed, otherwise it is skipped (reported as skipped, not failed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/upscale.ts tests/upscale-pipeline.test.ts
git commit -m "feat: realesrgan-based 4K upscale pipeline (segmented, atomic swap)"
```

---

## Task 6: Single-job lock + request eligibility

**Files:**
- Create: `src/lib/upscaleLock.ts`
- Create: `src/lib/upscaleEligibility.ts`
- Test: `tests/upscale-lock.test.ts`, `tests/upscale-eligibility.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/upscale-lock.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { tryAcquire, release, activeUpscale } from "@/lib/upscaleLock";

beforeEach(() => {
  // Ensure a clean lock between tests.
  const a = activeUpscale();
  if (a) release(a);
});

describe("upscaleLock", () => {
  it("acquires when free and reports the active id", () => {
    expect(tryAcquire("a")).toBe(true);
    expect(activeUpscale()).toBe("a");
  });
  it("refuses a second acquire while held", () => {
    expect(tryAcquire("a")).toBe(true);
    expect(tryAcquire("b")).toBe(false);
    expect(activeUpscale()).toBe("a");
  });
  it("release frees the lock only for the holder", () => {
    tryAcquire("a");
    release("b"); // not the holder — no-op
    expect(activeUpscale()).toBe("a");
    release("a");
    expect(activeUpscale()).toBeNull();
    expect(tryAcquire("b")).toBe(true);
  });
});
```

Create `tests/upscale-eligibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkUpscaleEligibility } from "@/lib/upscaleEligibility";
import type { Video } from "@/lib/types";

const ready: Video = { id: "a", title: "A", type: "vod", status: "ready", path: "vod/a/master.m3u8", createdAt: 1 };

describe("checkUpscaleEligibility", () => {
  it("404 when the video is missing", () => {
    expect(checkUpscaleEligibility(undefined, false)).toEqual({ ok: false, status: 404, error: "not found" });
  });
  it("409 when the video is not ready", () => {
    expect(checkUpscaleEligibility({ ...ready, status: "processing" }, false))
      .toEqual({ ok: false, status: 409, error: "video not ready" });
  });
  it("409 when already upscaling or upscaled", () => {
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "upscaling" }, false).status).toBe(409);
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "upscaled" }, false).status).toBe(409);
  });
  it("409 when another upscale is running (locked)", () => {
    expect(checkUpscaleEligibility(ready, true))
      .toEqual({ ok: false, status: 409, error: "another upscale is running" });
  });
  it("ok for a ready, not-yet-upscaled video when unlocked", () => {
    expect(checkUpscaleEligibility(ready, false)).toEqual({ ok: true });
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "failed" }, false)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/upscale-lock.test.ts tests/upscale-eligibility.test.ts`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Implement**

Create `src/lib/upscaleLock.ts`:

```ts
// Process-wide single-flight lock: only one upscale job runs at a time so the
// GPU and disk aren't thrashed by concurrent jobs.
let active: string | null = null;

export function tryAcquire(id: string): boolean {
  if (active) return false;
  active = id;
  return true;
}

export function release(id: string): void {
  if (active === id) active = null;
}

export function activeUpscale(): string | null {
  return active;
}
```

Create `src/lib/upscaleEligibility.ts`:

```ts
import type { Video } from "./types";

export type UpscaleEligibility =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Pure decision: may this video start an upscale right now? */
export function checkUpscaleEligibility(video: Video | undefined, locked: boolean): UpscaleEligibility {
  if (!video) return { ok: false, status: 404, error: "not found" };
  if (video.status !== "ready") return { ok: false, status: 409, error: "video not ready" };
  if (video.upscaleStatus === "upscaling") return { ok: false, status: 409, error: "already upscaling" };
  if (video.upscaleStatus === "upscaled") return { ok: false, status: 409, error: "already upscaled" };
  if (locked) return { ok: false, status: 409, error: "another upscale is running" };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/upscale-lock.test.ts tests/upscale-eligibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/upscaleLock.ts src/lib/upscaleEligibility.ts tests/upscale-lock.test.ts tests/upscale-eligibility.test.ts
git commit -m "feat: upscale single-job lock and request-eligibility decision"
```

---

## Task 7: API route to start an upscale

**Files:**
- Create: `src/app/api/videos/[id]/upscale/route.ts`
- Test: `tests/upscale-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/upscale-route.test.ts`. It drives the route handler directly with an in-memory DB and asserts the guard responses (the happy path is covered by the eligibility/pipeline tests; here we assert 404/409 without launching a real job):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, insertVideo, setUpscaleStatus } from "@/lib/db";
import { release, activeUpscale } from "@/lib/upscaleLock";
import { POST } from "@/app/api/videos/[id]/upscale/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  openDb(":memory:");
  const a = activeUpscale();
  if (a) release(a);
});

describe("POST /api/videos/[id]/upscale", () => {
  it("404s for an unknown id", async () => {
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("409s when the video is not ready", async () => {
    insertVideo({ id: "p", title: "P", type: "vod", status: "processing", path: "vod/p/master.m3u8", createdAt: 1 });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("p"));
    expect(res.status).toBe(409);
  });

  it("409s when already upscaled", async () => {
    insertVideo({ id: "d", title: "D", type: "vod", status: "ready", path: "vod/d/master.m3u8", createdAt: 1 });
    setUpscaleStatus("d", "upscaled");
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("d"));
    expect(res.status).toBe(409);
  });

  it("404s when ready but the original source file is missing", async () => {
    insertVideo({ id: "r", title: "R", type: "vod", status: "ready", path: "vod/r/master.m3u8", createdAt: 1 });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx("r"));
    // Eligible, lock acquired, but findUpload returns null (no media/uploads/r.*).
    expect(res.status).toBe(404);
    expect(activeUpscale()).toBeNull(); // lock released on the early return
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/upscale-route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/videos/[id]/upscale/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getVideo, setUpscaleStatus, setUpscaleProgress } from "@/lib/db";
import { findUpload, vodDir } from "@/lib/paths";
import { checkUpscaleEligibility } from "@/lib/upscaleEligibility";
import { tryAcquire, release, activeUpscale } from "@/lib/upscaleLock";
import { upscaleVideoToHls } from "@/lib/upscale";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);

  const elig = checkUpscaleEligibility(video, activeUpscale() !== null);
  if (!elig.ok) return NextResponse.json({ error: elig.error }, { status: elig.status });

  // Eligible — claim the single-job lock (guards against a race between checks).
  if (!tryAcquire(id)) {
    return NextResponse.json({ error: "another upscale is running" }, { status: 409 });
  }

  const source = findUpload(id);
  if (!source) {
    release(id);
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  setUpscaleStatus(id, "upscaling");
  setUpscaleProgress(id, 0);

  // Fire-and-forget, mirroring the upload route. Progress is advisory.
  upscaleVideoToHls(source, vodDir(id), (p) => setUpscaleProgress(id, p))
    .then(() => setUpscaleStatus(id, "upscaled"))
    .catch((err) => {
      console.error(`upscale failed for ${id}:`, err);
      setUpscaleStatus(id, "failed");
    })
    .finally(() => release(id));

  return NextResponse.json({ id, upscaleStatus: "upscaling" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/upscale-route.test.ts`
Expected: PASS — all four guard cases return the expected status, and the lock is released on the missing-source path.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/videos/[id]/upscale/route.ts" tests/upscale-route.test.ts
git commit -m "feat: POST /api/videos/[id]/upscale to start an upscale job"
```

---

## Task 8: Video card UI — button, progress, 4K badge

**Files:**
- Modify: `src/components/VideoCard.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/video-card-upscale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/video-card-upscale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { upscaleAction } from "@/components/VideoCard";
import type { Video } from "@/lib/types";

const base: Pick<Video, "status" | "upscaleStatus" | "upscaleProgress"> = {
  status: "ready",
};

describe("upscaleAction", () => {
  it("offers the button for a ready, not-yet-upscaled video", () => {
    expect(upscaleAction(base)).toEqual({ kind: "button" });
    expect(upscaleAction({ ...base, upscaleStatus: "none" })).toEqual({ kind: "button" });
    expect(upscaleAction({ ...base, upscaleStatus: "failed" })).toEqual({ kind: "button" });
  });
  it("shows progress while upscaling, clamped 0–100", () => {
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling", upscaleProgress: 40 })).toEqual({ kind: "progress", pct: 40 });
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling", upscaleProgress: 250 })).toEqual({ kind: "progress", pct: 100 });
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling" })).toEqual({ kind: "progress", pct: 0 });
  });
  it("shows the 4K badge once upscaled", () => {
    expect(upscaleAction({ ...base, upscaleStatus: "upscaled" })).toEqual({ kind: "badge" });
  });
  it("offers nothing for non-ready videos", () => {
    expect(upscaleAction({ status: "processing" })).toEqual({ kind: "none" });
    expect(upscaleAction({ status: "failed" })).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/video-card-upscale.test.ts`
Expected: FAIL — `upscaleAction` not exported.

- [ ] **Step 3: Add the pure helper + UI to `VideoCard.tsx`**

In `src/components/VideoCard.tsx`, add the `"use client";` directive as the very first line (it now contains an event handler and is rendered inside the client `page.tsx`).

Update the imports to bring in the upscale type and React state:

```ts
import { useState } from "react";
import type { Video, VideoStatus, UpscaleStatus } from "@/lib/types";
```

Add the exported pure decision near `progressDisplay`:

```ts
export type UpscaleAction =
  | { kind: "none" }
  | { kind: "button" }
  | { kind: "progress"; pct: number }
  | { kind: "badge" };

/**
 * Pure decision for the per-card upscale control, factored out for unit testing
 * (vitest runs `environment: "node"`):
 *  - non-ready video                 → no control
 *  - ready + none/failed/undefined   → "Upscale to 4K" button
 *  - upscaling                       → progress bar (clamped 0–100)
 *  - upscaled                        → "4K" badge
 */
export function upscaleAction(
  video: Pick<Video, "status" | "upscaleStatus" | "upscaleProgress">,
): UpscaleAction {
  if (video.status !== "ready") return { kind: "none" };
  if (video.upscaleStatus === "upscaling") {
    const pct = Math.max(0, Math.min(100, video.upscaleProgress ?? 0));
    return { kind: "progress", pct };
  }
  if (video.upscaleStatus === "upscaled") return { kind: "badge" };
  return { kind: "button" };
}
```

Add a small client control component (place it above `export default function VideoCard`):

```tsx
function UpscaleControl({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const action = upscaleAction(video);

  if (action.kind === "none") return null;

  if (action.kind === "badge") {
    return (
      <span className="mt-2 inline-block rounded-full bg-yt-red px-2 py-0.5 text-xs font-medium text-white">
        4K
      </span>
    );
  }

  if (action.kind === "progress") {
    return (
      <div className="mt-2">
        <div
          className="h-2 w-full overflow-hidden rounded bg-yt-bg"
          role="progressbar"
          aria-valuenow={action.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Upscaling ${video.title}: ${action.pct}%`}
        >
          <div className="h-full bg-yt-red transition-all" style={{ width: `${action.pct}%` }} />
        </div>
        <span className="mt-1 block text-xs text-yt-subtext">Upscaling… {action.pct}%</span>
      </div>
    );
  }

  // action.kind === "button"
  async function start(e: React.MouseEvent) {
    e.preventDefault(); // don't trigger the card's watch link
    e.stopPropagation();
    setBusy(true);
    try {
      await fetch(`/api/videos/${video.id}/upscale`, { method: "POST" });
    } finally {
      setBusy(false);
      onChanged?.();
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className="mt-2 rounded-full border border-yt-surface px-3 py-1 text-xs font-medium text-yt-text transition-colors hover:bg-yt-surface disabled:opacity-50"
    >
      {busy ? "Starting…" : "Upscale to 4K"}
    </button>
  );
}
```

Update `VideoCard` to accept and render the control. Change its signature and body:

```tsx
export default function VideoCard({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const body = (
    <>
      <Thumbnail video={video} />
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-yt-text">
          {video.title}
        </h3>
        <StatusBadge status={video.status} />
      </div>
      <ProgressBar video={video} />
      <UpscaleControl video={video} onChanged={onChanged} />
    </>
  );
```

Leave the `ready` vs non-ready link/div branching below it unchanged. (The upscale button calls `preventDefault`/`stopPropagation`, so clicking it inside the watch `<Link>` won't navigate.)

- [ ] **Step 4: Wire `page.tsx`**

In `src/app/page.tsx`:

Pass the refresh callback to each card — change the map:

```tsx
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onChanged={refresh} />
          ))}
```

Keep the fast poll while either transcoding or upscaling is in flight — replace the `hasProcessing` line:

```tsx
  const isBusy = videos.some((v) => v.status === "processing" || v.upscaleStatus === "upscaling");
```

and update the effect to depend on and use `isBusy`:

```tsx
  useEffect(() => {
    refresh();
    const intervalMs = isBusy ? 2000 : 4000;
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [isBusy]);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/video-card-upscale.test.ts && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/VideoCard.tsx src/app/page.tsx tests/video-card-upscale.test.ts
git commit -m "feat: per-card Upscale to 4K button, progress, and 4K badge"
```

---

## Task 9: Config + documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document install + config**

Add a section to `README.md`:

```markdown
## 4K AI upscaling (optional)

Ready VODs show an **Upscale to 4K** button. It runs Real-ESRGAN super-resolution
on the original upload, then rebuilds the HLS ladder with a true 2160p rendition.
This is GPU-bound and slow — expect minutes of processing per minute of video.

Requires the `realesrgan-ncnn-vulkan` binary and its model files:

    brew install realesrgan-ncnn-vulkan
    # or download a release from https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan

Environment variables:

- `REALESRGAN_PATH` — path to the binary (default `realesrgan-ncnn-vulkan`)
- `REALESRGAN_MODEL` — model name (default `realesrgan-x4plus`)
- `REALESRGAN_MODELS` — optional path to the models directory (passed as `-m`)

Only one upscale job runs at a time. If the binary is missing the job fails and
the card shows a failed state; the original video remains playable.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document 4K upscaling install and configuration"
```

---

## Task 10: Full-suite verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS. The heavy `upscale-pipeline` GPU test is skipped unless `realesrgan-ncnn-vulkan` is installed; everything else (db, paths, ladder, helpers, lock, eligibility, route, card) passes.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; Next build succeeds.

- [ ] **Step 3: Manual smoke test (requires the binary + a short clip)**

1. Ensure `realesrgan-ncnn-vulkan` is installed.
2. `npm run dev`, upload a short clip, wait for "Ready".
3. Click **Upscale to 4K**; confirm the card shows "Upscaling… N%" and the home page polls every 2s.
4. When it finishes, confirm a **4K** badge, then open the watch page and verify the player offers/plays a 2160p rendition (check `media/vod/<id>/master.m3u8` contains `RESOLUTION=3840x2160`).

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: 4K upscaling verification pass" || echo "nothing to commit"
```
```
