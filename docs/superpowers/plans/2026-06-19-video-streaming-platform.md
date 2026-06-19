# Video Streaming Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only prototype web app that streams both on-demand (uploaded, transcoded) and live (OBS → RTMP) video to the browser via HLS.

**Architecture:** A Next.js app serves the player UI and thin API routes. Uploaded files are transcoded to HLS by an FFmpeg worker; live RTMP from OBS is repackaged to HLS by a standalone node-media-server process. All producers write HLS files to a shared `media/` directory on disk; a SQLite database tracks the library. The browser plays every stream with one hls.js-based player component.

**Tech Stack:** Next.js (App Router) + TypeScript, node-media-server, FFmpeg, hls.js, better-sqlite3, Tailwind CSS, Vitest (tests). OBS Studio is the external broadcaster.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts` | Project config |
| `src/lib/paths.ts` | Resolves all `media/` paths from one place (the disk contract) |
| `src/lib/db.ts` | SQLite metadata store for the video library |
| `src/lib/transcode.ts` | FFmpeg VOD worker: input file → HLS ladder on disk |
| `src/lib/types.ts` | Shared TypeScript types (`Video`, `VideoStatus`, etc.) |
| `src/app/api/upload/route.ts` | Accepts an uploaded file, starts transcode |
| `src/app/api/videos/route.ts` | Lists the library |
| `src/app/api/live/status/route.ts` | Reports which live streams are active |
| `src/app/media/[...path]/route.ts` | Serves HLS files (`.m3u8`, `.ts`) from `media/` |
| `src/components/Player.tsx` | hls.js player; same component for VOD + live |
| `src/app/page.tsx` | Library / browse page |
| `src/app/watch/[id]/page.tsx` | VOD watch page |
| `src/app/live/[key]/page.tsx` | Live watch page |
| `media-server.mjs` | Standalone node-media-server process (RTMP→HLS) |
| `tests/fixtures/sample.mp4` | Tiny generated clip for transcode tests |
| `tests/*.test.ts` | Unit + integration tests |
| `README.md` | Setup + manual live smoke-test checklist |

`media/` layout at runtime (gitignored): `media/uploads/` (raw uploads), `media/vod/<id>/` (VOD HLS), `media/live/<key>/` (live HLS).

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx`, `.env.local.example`

- [ ] **Step 1: Verify FFmpeg is installed (required dependency)**

Run: `ffmpeg -version`
Expected: prints a version banner. If "command not found", install it: `brew install ffmpeg` (macOS).

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "video-streaming-platform",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "media-server": "node media-server.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "hls.js": "^1.5.20",
    "next": "^15.1.6",
    "node-media-server": "^2.7.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.7",
    "@types/react": "^19.0.7",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3",
    "vitest": "^3.0.4"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no fatal errors. (better-sqlite3 compiles a native binding; on failure ensure Xcode CLT / build tools are present.)

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 6: Create Tailwind config files**

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`postcss.config.mjs`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 7: Create `src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Create `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Streaming Prototype",
  description: "VOD + live streaming demo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen">{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create `.env.local.example`**

```
# Port the standalone RTMP/HLS media server listens on for HLS output is handled in-process.
# RTMP ingest port:
RTMP_PORT=1935
# Allowed live stream key (only this key may publish):
LIVE_STREAM_KEY=devkey
```

- [ ] **Step 10: Verify the app builds and runs**

Run: `npm run dev` then open http://localhost:3000
Expected: Next.js starts; the default route 404s (no `page.tsx` yet) but the server runs without errors. Stop with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + TS + Tailwind project"
```

---

## Task 2: Shared types and media paths

**Files:**
- Create: `src/lib/types.ts`, `src/lib/paths.ts`
- Test: `tests/paths.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
```

- [ ] **Step 2: Create `src/lib/types.ts`**

```ts
export type VideoStatus = "processing" | "ready" | "failed";
export type VideoType = "vod" | "live";

export interface Video {
  id: string;
  title: string;
  type: VideoType;
  status: VideoStatus;
  path: string; // relative media path to the master playlist, e.g. "vod/<id>/master.m3u8"
  createdAt: number;
}
```

- [ ] **Step 3: Write the failing test for paths**

`tests/paths.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mediaRoot, uploadPath, vodDir, vodPlaylist, livePlaylist } from "@/lib/paths";
import path from "node:path";

describe("paths", () => {
  it("places media under <root>/media", () => {
    expect(mediaRoot()).toBe(path.join(process.cwd(), "media"));
  });
  it("builds an upload path inside media/uploads", () => {
    expect(uploadPath("abc.mp4")).toBe(path.join(mediaRoot(), "uploads", "abc.mp4"));
  });
  it("builds a vod dir and its master playlist", () => {
    expect(vodDir("id1")).toBe(path.join(mediaRoot(), "vod", "id1"));
    expect(vodPlaylist("id1")).toBe("vod/id1/master.m3u8");
  });
  it("builds a live playlist relative path", () => {
    expect(livePlaylist("devkey")).toBe("live/devkey/index.m3u8");
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm test -- tests/paths.test.ts`
Expected: FAIL — cannot resolve `@/lib/paths`.

- [ ] **Step 5: Implement `src/lib/paths.ts`**

```ts
import path from "node:path";

export function mediaRoot(): string {
  return path.join(process.cwd(), "media");
}
export function uploadPath(filename: string): string {
  return path.join(mediaRoot(), "uploads", filename);
}
export function vodDir(id: string): string {
  return path.join(mediaRoot(), "vod", id);
}
/** Relative path (for browser URLs) to a VOD master playlist. */
export function vodPlaylist(id: string): string {
  return `vod/${id}/master.m3u8`;
}
export function liveDir(key: string): string {
  return path.join(mediaRoot(), "live", key);
}
/** Relative path (for browser URLs) to a live playlist. */
export function livePlaylist(key: string): string {
  return `live/${key}/index.m3u8`;
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm test -- tests/paths.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add shared types and media path helpers"
```

---

## Task 3: SQLite metadata store

**Files:**
- Create: `src/lib/db.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb, insertVideo, listVideos, getVideo, setStatus } from "@/lib/db";

beforeEach(() => {
  // Use an in-memory DB for isolation.
  openDb(":memory:");
});

describe("db", () => {
  it("inserts and lists videos newest-first", () => {
    insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
    insertVideo({ id: "b", title: "Second", type: "vod", status: "processing", path: "vod/b/master.m3u8", createdAt: 2 });
    const all = listVideos();
    expect(all.map((v) => v.id)).toEqual(["b", "a"]);
  });

  it("gets a single video by id", () => {
    insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
    expect(getVideo("a")?.title).toBe("First");
    expect(getVideo("missing")).toBeUndefined();
  });

  it("updates status", () => {
    insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
    setStatus("a", "ready");
    expect(getVideo("a")?.status).toBe("ready");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — cannot resolve `@/lib/db`.

- [ ] **Step 3: Implement `src/lib/db.ts`**

```ts
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Video, VideoStatus } from "./types";

let db: Database.Database | null = null;

export function openDb(file?: string): Database.Database {
  const target = file ?? path.join(process.cwd(), "media", "library.db");
  if (!file || file !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  db = new Database(target);
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      path TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
  return db;
}

function conn(): Database.Database {
  if (!db) openDb();
  return db!;
}

export function insertVideo(v: Video): void {
  conn()
    .prepare(`INSERT INTO videos (id, title, type, status, path, createdAt) VALUES (@id, @title, @type, @status, @path, @createdAt)`)
    .run(v);
}

export function listVideos(): Video[] {
  return conn().prepare(`SELECT * FROM videos ORDER BY createdAt DESC`).all() as Video[];
}

export function getVideo(id: string): Video | undefined {
  return conn().prepare(`SELECT * FROM videos WHERE id = ?`).get(id) as Video | undefined;
}

export function setStatus(id: string, status: VideoStatus): void {
  conn().prepare(`UPDATE videos SET status = ? WHERE id = ?`).run(status, id);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add SQLite metadata store"
```

---

## Task 4: FFmpeg VOD transcode worker

**Files:**
- Create: `src/lib/transcode.ts`
- Test: `tests/transcode.test.ts`
- Create (generated): `tests/fixtures/sample.mp4`

- [ ] **Step 1: Generate a tiny sample video fixture and commit it**

Run:
```bash
mkdir -p tests/fixtures
ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=15 \
  -f lavfi -i sine=frequency=440:duration=2 \
  -c:v libx264 -c:a aac -shortest tests/fixtures/sample.mp4
```
Expected: `tests/fixtures/sample.mp4` exists (a 2-second clip). This file is committed so tests don't need user input.

- [ ] **Step 2: Write the failing test**

`tests/transcode.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { transcodeToHls } from "@/lib/transcode";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hls-"));

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe("transcodeToHls", () => {
  it("produces a master playlist and at least one segment", async () => {
    await transcodeToHls("tests/fixtures/sample.mp4", outDir);
    expect(fs.existsSync(path.join(outDir, "master.m3u8"))).toBe(true);
    const files = fs.readdirSync(outDir);
    expect(files.some((f) => f.endsWith(".ts"))).toBe(true);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    await expect(transcodeToHls("tests/fixtures/nope.mp4", outDir)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm test -- tests/transcode.test.ts`
Expected: FAIL — cannot resolve `@/lib/transcode`.

- [ ] **Step 4: Implement `src/lib/transcode.ts`**

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Transcode an input video into an HLS adaptive-bitrate ladder (720p + 480p)
 * written to outDir. Resolves on success, rejects on non-zero exit / missing input.
 */
export function transcodeToHls(inputPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }
    fs.mkdirSync(outDir, { recursive: true });

    // Two renditions; %v expands to the variant index (0,1) into per-variant dirs.
    const args = [
      "-y",
      "-i", inputPath,
      "-filter_complex", "[0:v]split=2[v0][v1];[v0]scale=w=1280:h=720[v0out];[v1]scale=w=854:h=480[v1out]",
      "-map", "[v0out]", "-c:v:0", "libx264", "-b:v:0", "2800k",
      "-map", "[v1out]", "-c:v:1", "libx264", "-b:v:1", "1400k",
      "-map", "a:0?", "-map", "a:0?", "-c:a", "aac", "-b:a", "128k",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(outDir, "v%v_%03d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", "v:0,a:0 v:1,a:1",
      path.join(outDir, "v%v.m3u8"),
    ];

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
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test -- tests/transcode.test.ts`
Expected: PASS (2 tests). The first may take several seconds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add FFmpeg VOD transcode worker + sample fixture"
```

---

## Task 5: Media file-serving route

**Files:**
- Create: `src/app/media/[...path]/route.ts`
- Test: `tests/media-route.test.ts`

This route serves files from `media/` with correct HLS content types, since `media/` is outside Next's static `public/` dir.

- [ ] **Step 1: Write the failing test for the content-type helper**

`tests/media-route.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { contentTypeFor } from "@/app/media/[...path]/route";

describe("contentTypeFor", () => {
  it("maps m3u8 to the HLS playlist type", () => {
    expect(contentTypeFor("master.m3u8")).toBe("application/vnd.apple.mpegurl");
  });
  it("maps ts to MPEG transport stream", () => {
    expect(contentTypeFor("v0_001.ts")).toBe("video/mp2t");
  });
  it("falls back to octet-stream", () => {
    expect(contentTypeFor("notes.txt")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/media-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/media/[...path]/route.ts`**

```ts
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { mediaRoot } from "@/lib/paths";

export function contentTypeFor(name: string): string {
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".ts")) return "video/mp2t";
  if (name.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  // Prevent path traversal: reject any ".." segment.
  if (parts.some((p) => p === ".." || p.includes("\0"))) {
    return new Response("Bad request", { status: 400 });
  }
  const filePath = path.join(mediaRoot(), ...parts);
  if (!filePath.startsWith(mediaRoot()) || !fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-cache",
    },
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/media-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: serve HLS files from media/ with correct content types"
```

---

## Task 6: Upload + library API routes

**Files:**
- Create: `src/lib/ids.ts`
- Create: `src/app/api/upload/route.ts`
- Create: `src/app/api/videos/route.ts`
- Test: `tests/ids.test.ts`

- [ ] **Step 1: Write the failing test for the id helper**

`tests/ids.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newId } from "@/lib/ids";

describe("newId", () => {
  it("returns a non-empty unique-ish string", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/ids.ts`**

```ts
import { randomBytes } from "node:crypto";

export function newId(): string {
  return randomBytes(8).toString("hex");
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/ids.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/app/api/upload/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { newId } from "@/lib/ids";
import { uploadPath, vodDir, vodPlaylist } from "@/lib/paths";
import { insertVideo, setStatus } from "@/lib/db";
import { transcodeToHls } from "@/lib/transcode";

const ALLOWED = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"];

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const title = (form.get("title") as string) || "Untitled";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `unsupported type: ${file.type}` }, { status: 400 });
  }

  const id = newId();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "mp4";
  const savedPath = uploadPath(`${id}.${ext}`);
  fs.mkdirSync(uploadPath("").replace(/\/$/, ""), { recursive: true });
  fs.writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()));

  insertVideo({
    id,
    title,
    type: "vod",
    status: "processing",
    path: vodPlaylist(id),
    createdAt: Date.now(),
  });

  // Fire-and-forget transcode; status updates when it finishes.
  transcodeToHls(savedPath, vodDir(id))
    .then(() => setStatus(id, "ready"))
    .catch((err) => {
      console.error(`transcode failed for ${id}:`, err);
      setStatus(id, "failed");
    });

  return NextResponse.json({ id, status: "processing" });
}
```

- [ ] **Step 6: Implement `src/app/api/videos/route.ts`**

```ts
import { NextResponse } from "next/server";
import { listVideos } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ videos: listVideos() });
}
```

- [ ] **Step 7: Manually verify upload end-to-end**

Run (in one terminal): `npm run dev`
Run (in another):
```bash
curl -F "title=Sample" -F "file=@tests/fixtures/sample.mp4" http://localhost:3000/api/upload
sleep 8
curl http://localhost:3000/api/videos
```
Expected: upload returns `{"id":"...","status":"processing"}`; after the sleep, `/api/videos` shows that video with `"status":"ready"` and a `master.m3u8` exists under `media/vod/<id>/`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add upload (transcode) and library list API routes"
```

---

## Task 7: HLS player component

**Files:**
- Create: `src/components/Player.tsx`

No unit test (browser/DOM + hls.js network behavior); verified visually in Task 8 and the smoke test.

- [ ] **Step 1: Implement `src/components/Player.tsx`**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

/** Plays an HLS source (.m3u8). Works for both VOD and live. `src` is a relative
 *  media URL like "/media/vod/<id>/master.m3u8". */
export default function Player({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    // Safari plays HLS natively.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError("Stream unavailable or still processing.");
      });
      return () => hls.destroy();
    }
    setError("HLS is not supported in this browser.");
  }, [src]);

  if (error) {
    return <div className="aspect-video grid place-items-center bg-neutral-900 text-neutral-400">{error}</div>;
  }
  return <video ref={videoRef} controls className="w-full aspect-video bg-black" />;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add hls.js player component for VOD + live"
```

---

## Task 8: Library and VOD watch pages

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/app/watch/[id]/page.tsx`

- [ ] **Step 1: Implement `src/app/page.tsx` (library + upload form)**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Video } from "@/lib/types";

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/videos");
    const data = await res.json();
    setVideos(data.videos);
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000); // reflect processing → ready
    return () => clearInterval(t);
  }, []);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/upload", { method: "POST", body: new FormData(e.currentTarget) });
    (e.target as HTMLFormElement).reset();
    setBusy(false);
    refresh();
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Streaming Prototype</h1>

      <form onSubmit={onUpload} className="space-y-2 bg-neutral-900 p-4 rounded">
        <h2 className="font-semibold">Upload a video (VOD)</h2>
        <input name="title" placeholder="Title" className="w-full p-2 rounded bg-neutral-800" />
        <input name="file" type="file" accept="video/*" required className="block" />
        <button disabled={busy} className="px-4 py-2 bg-blue-600 rounded disabled:opacity-50">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">Library</h2>
        <p className="text-sm text-neutral-400">
          Live: point OBS at <code>rtmp://localhost:1935/live/devkey</code>, then open{" "}
          <Link href="/live/devkey" className="text-blue-400 underline">the live page</Link>.
        </p>
        {videos.length === 0 && <p className="text-neutral-500">No videos yet.</p>}
        <ul className="divide-y divide-neutral-800">
          {videos.map((v) => (
            <li key={v.id} className="py-2 flex justify-between">
              <span>{v.title}</span>
              {v.status === "ready" ? (
                <Link href={`/watch/${v.id}`} className="text-blue-400 underline">Watch</Link>
              ) : (
                <span className="text-neutral-500">{v.status}…</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Implement `src/app/watch/[id]/page.tsx`**

```tsx
import Player from "@/components/Player";
import { getVideo } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function Watch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) notFound();

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <Link href="/" className="text-blue-400 underline">← Library</Link>
      <h1 className="text-xl font-bold">{video.title}</h1>
      <Player src={`/media/${video.path}`} />
    </main>
  );
}
```

- [ ] **Step 3: Verify VOD playback in a browser**

Run: `npm run dev`, open http://localhost:3000, upload `tests/fixtures/sample.mp4`, wait until it shows "Watch", click it.
Expected: the 2-second clip plays in the browser.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add library page with upload and VOD watch page"
```

---

## Task 9: Live media server (RTMP → HLS)

**Files:**
- Create: `media-server.mjs`

- [ ] **Step 1: Implement `media-server.mjs`**

```js
// Standalone process: accepts RTMP from OBS and writes HLS into media/live/<key>/.
// Run with: npm run media-server
import NodeMediaServer from "node-media-server";
import path from "node:path";

const RTMP_PORT = Number(process.env.RTMP_PORT || 1935);
const ALLOWED_KEY = process.env.LIVE_STREAM_KEY || "devkey";
const MEDIA_ROOT = path.join(process.cwd(), "media");

const nms = new NodeMediaServer({
  rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  http: { port: 8000, mediaroot: MEDIA_ROOT, allow_origin: "*" },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    tasks: [
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=2:hls_list_size=4:hls_flags=delete_segments]",
      },
    ],
  },
});

// Reject publishes whose stream key isn't the allowed one.
nms.on("prePublish", (id, streamPath) => {
  const key = streamPath.split("/").pop();
  if (key !== ALLOWED_KEY) {
    const session = nms.getSession(id);
    console.warn(`rejecting publish with bad key: ${key}`);
    session.reject();
  } else {
    console.log(`live stream started: ${streamPath}`);
  }
});

nms.on("donePublish", (_id, streamPath) => console.log(`live stream ended: ${streamPath}`));

nms.run();
console.log(`RTMP ingest on rtmp://localhost:${RTMP_PORT}/live/<key>; HLS under media/live/<key>/`);
```

- [ ] **Step 2: Verify the media server boots**

Run: `npm run media-server`
Expected: logs the "RTMP ingest on …" line and stays running. Stop with Ctrl-C. (node-media-server uses its bundled ffmpeg config; `trans` requires the `ffmpeg` binary from Task 1.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add standalone RTMP->HLS media server"
```

---

## Task 10: Live status API and live watch page

**Files:**
- Create: `src/app/api/live/status/route.ts`
- Create: `src/app/live/[key]/page.tsx`
- Test: `tests/live-status.test.ts`

- [ ] **Step 1: Write the failing test for the liveness helper**

`tests/live-status.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { isLive } from "@/app/api/live/status/route";
import fs from "node:fs";
import path from "node:path";
import { liveDir } from "@/lib/paths";

const key = "testkey";
afterAll(() => fs.rmSync(liveDir(key), { recursive: true, force: true }));

describe("isLive", () => {
  it("is false when no playlist exists", () => {
    expect(isLive(key)).toBe(false);
  });
  it("is true once an index.m3u8 exists", () => {
    fs.mkdirSync(liveDir(key), { recursive: true });
    fs.writeFileSync(path.join(liveDir(key), "index.m3u8"), "#EXTM3U");
    expect(isLive(key)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test -- tests/live-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/live/status/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { liveDir } from "@/lib/paths";

/** A stream is "live" if its HLS playlist currently exists on disk. */
export function isLive(key: string): boolean {
  return fs.existsSync(path.join(liveDir(key), "index.m3u8"));
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  return NextResponse.json({ key, live: key ? isLive(key) : false });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test -- tests/live-status.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `src/app/live/[key]/page.tsx`**

```tsx
"use client";
import { use, useEffect, useState } from "react";
import Player from "@/components/Player";
import Link from "next/link";
import { livePlaylist } from "@/lib/paths";

export default function Live({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [live, setLive] = useState(false);

  useEffect(() => {
    async function poll() {
      const res = await fetch(`/api/live/status?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      setLive(data.live);
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [key]);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <Link href="/" className="text-blue-400 underline">← Library</Link>
      <h1 className="text-xl font-bold">Live: {key}</h1>
      {live ? (
        <Player src={`/media/${livePlaylist(key)}`} />
      ) : (
        <div className="aspect-video grid place-items-center bg-neutral-900 text-neutral-400">
          Offline — start streaming from OBS to <code>rtmp://localhost:1935/live/{key}</code>.
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add live status API and live watch page"
```

---

## Task 11: Integration test, README, and final verification

**Files:**
- Create: `tests/upload-integration.test.ts`
- Create: `README.md`

- [ ] **Step 1: Write the integration test for the VOD pipeline**

`tests/upload-integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { openDb, getVideo } from "@/lib/db";
import { transcodeToHls } from "@/lib/transcode";
import { vodDir } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";

// Exercises the same pieces the upload route wires together: insert → transcode → ready.
const id = "itest";
beforeEach(() => openDb(":memory:"));
afterAll(() => fs.rmSync(vodDir(id), { recursive: true, force: true }));

describe("VOD pipeline", () => {
  it("transcodes a sample and yields a playable master playlist", async () => {
    await transcodeToHls("tests/fixtures/sample.mp4", vodDir(id));
    expect(fs.existsSync(path.join(vodDir(id), "master.m3u8"))).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 3: Create `README.md` with setup + live smoke-test checklist**

````markdown
# Video Streaming Prototype

Local-only demo that streams both on-demand (uploaded → transcoded) and live
(OBS → RTMP) video to the browser via HLS.

## Requirements
- Node.js 20+
- FFmpeg on PATH (`ffmpeg -version`)
- OBS Studio (for the live demo)

## Setup
```bash
npm install
cp .env.local.example .env.local
```

## Run
Two processes, in separate terminals:
```bash
npm run dev            # Next.js app at http://localhost:3000
npm run media-server   # RTMP ingest at rtmp://localhost:1935
```

## VOD demo
1. Open http://localhost:3000
2. Upload a video. It shows "processing…" then "Watch" when transcoded.
3. Click Watch — it plays via HLS with adaptive bitrate.

## Live smoke-test checklist (manual)
1. Start both processes above.
2. In OBS → Settings → Stream: Service "Custom", Server
   `rtmp://localhost:1935/live`, Stream Key `devkey`.
3. Click "Start Streaming" in OBS.
4. Open http://localhost:3000/live/devkey — within a few seconds it flips from
   "Offline" to a live player showing your broadcast (a few seconds of latency
   is normal for HLS).
5. Click "Stop Streaming" in OBS — the page returns to "Offline".

## Tests
```bash
npm test
```
````

- [ ] **Step 4: Final full verification**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tests pass, no type errors, production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: add VOD integration test; docs: add README with live smoke test"
```

---

## Done

After Task 11 the prototype is feature-complete per the spec: VOD upload→transcode→playback, live RTMP→HLS playback, a browseable library, error handling on the realistic failure points, and tests covering the VOD path with a documented manual checklist for the live path.
