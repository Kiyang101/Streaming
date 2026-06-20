import { describe, it, expect, afterAll } from "vitest";
import { transcodeToHls, extractPoster, probeDuration } from "@/lib/transcode";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "hls-"));
const progressOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "hls-progress-"));
const posterDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-"));

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(progressOutDir, { recursive: true, force: true });
  fs.rmSync(posterDir, { recursive: true, force: true });
});

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

  it("reports non-decreasing progress culminating in exactly 100 when onProgress is supplied", async () => {
    const progressValues: number[] = [];
    await transcodeToHls("tests/fixtures/sample.mp4", progressOutDir, (percent) => {
      progressValues.push(percent);
    });

    expect(progressValues.length).toBeGreaterThan(0);
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
    }
    expect(progressValues[progressValues.length - 1]).toBe(100);
  }, 60_000);
});

describe("probeDuration", () => {
  it("resolves a positive duration in seconds for a valid input", async () => {
    const duration = await probeDuration("tests/fixtures/sample.mp4");
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    await expect(probeDuration("tests/fixtures/nope.mp4")).rejects.toThrow();
  });
});

describe("extractPoster", () => {
  it("writes a non-empty jpg to the given path", async () => {
    const outPath = path.join(posterDir, "thumb.jpg");
    await extractPoster("tests/fixtures/sample.mp4", outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    const outPath = path.join(posterDir, "missing-input.jpg");
    await expect(extractPoster("tests/fixtures/nope.mp4", outPath)).rejects.toThrow();
  });
});
