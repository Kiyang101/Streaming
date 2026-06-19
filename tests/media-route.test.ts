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
