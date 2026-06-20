import { describe, it, expect, afterAll } from "vitest";
import { isLive } from "@/lib/live";
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
