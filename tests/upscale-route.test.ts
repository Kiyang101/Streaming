import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
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
    const res = await POST(new NextRequest("http://x", { method: "POST" }), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("409s when the video is not ready", async () => {
    insertVideo({ id: "p", title: "P", type: "vod", status: "processing", path: "vod/p/master.m3u8", createdAt: 1 });
    const res = await POST(new NextRequest("http://x", { method: "POST" }), ctx("p"));
    expect(res.status).toBe(409);
  });

  it("409s when already upscaled", async () => {
    insertVideo({ id: "d", title: "D", type: "vod", status: "ready", path: "vod/d/master.m3u8", createdAt: 1 });
    setUpscaleStatus("d", "upscaled");
    const res = await POST(new NextRequest("http://x", { method: "POST" }), ctx("d"));
    expect(res.status).toBe(409);
  });

  it("404s when ready but the original source file is missing", async () => {
    insertVideo({ id: "r", title: "R", type: "vod", status: "ready", path: "vod/r/master.m3u8", createdAt: 1 });
    const res = await POST(new NextRequest("http://x", { method: "POST" }), ctx("r"));
    // Eligible, lock acquired, but findUpload returns null (no media/uploads/r.*).
    expect(res.status).toBe(404);
    expect(activeUpscale()).toBeNull(); // lock released on the early return
  });
});
