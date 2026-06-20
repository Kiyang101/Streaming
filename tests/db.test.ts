import { describe, it, expect, beforeEach } from "vitest";
import { openDb, insertVideo, listVideos, getVideo, setStatus, setThumbnail, setProgress, setUpscaleStatus, setUpscaleProgress } from "@/lib/db";

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

  describe("thumbnail column", () => {
    it("is null/undefined when a video is inserted without a thumbnail", () => {
      insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
      const v = getVideo("a");
      expect(v?.thumbnail == null).toBe(true);
    });

    it("persists via setThumbnail and is returned by getVideo", () => {
      insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
      setThumbnail("a", "vod/a/thumb.jpg");
      expect(getVideo("a")?.thumbnail).toBe("vod/a/thumb.jpg");
    });

    it("is included in listVideos results", () => {
      insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
      setThumbnail("a", "vod/a/thumb.jpg");
      const all = listVideos();
      expect(all.find((v) => v.id === "a")?.thumbnail).toBe("vod/a/thumb.jpg");
    });
  });

  describe("progress column", () => {
    it("is null/undefined when a video is freshly inserted", () => {
      insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
      const v = getVideo("a");
      expect(v?.progress == null).toBe(true);
    });

    it("persists via setProgress and is returned by getVideo", () => {
      insertVideo({ id: "a", title: "First", type: "vod", status: "processing", path: "vod/a/master.m3u8", createdAt: 1 });
      setProgress("a", 42);
      expect(getVideo("a")?.progress).toBe(42);
    });
  });
});

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
