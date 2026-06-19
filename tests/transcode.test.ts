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
