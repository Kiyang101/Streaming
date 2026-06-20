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
