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
