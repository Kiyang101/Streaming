import { describe, it, expect } from "vitest";
import { mediaRoot, uploadPath, vodDir, vodPlaylist, vodThumb, vodThumbRel, livePlaylist, matchUploadFile, uploadsDir } from "@/lib/paths";
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
  it("builds an absolute vod thumbnail path", () => {
    expect(vodThumb("id1")).toBe(path.join(mediaRoot(), "vod", "id1", "thumb.jpg"));
  });
  it("builds a relative vod thumbnail path", () => {
    expect(vodThumbRel("id1")).toBe("vod/id1/thumb.jpg");
  });
});

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
