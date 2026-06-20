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
