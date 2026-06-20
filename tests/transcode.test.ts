import { describe, it, expect, afterAll } from "vitest";
import { transcodeToHls, extractPosterAt, normalizeImageToJpeg, posterArgs, imageArgs, probeDuration } from "@/lib/transcode";
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

describe("posterArgs", () => {
  it("seeks to the given second with a single output frame", () => {
    expect(posterArgs("in.mp4", "out.jpg", 12)).toEqual([
      "-ss", "12", "-i", "in.mp4", "-frames:v", "1", "-y", "out.jpg",
    ]);
  });
  it("preserves the 1s default used at upload time", () => {
    expect(posterArgs("in.mp4", "out.jpg", 1)[1]).toBe("1");
  });
});

describe("imageArgs", () => {
  it("re-encodes a single frame from the input image", () => {
    expect(imageArgs("in.png", "out.jpg")).toEqual([
      "-i", "in.png", "-frames:v", "1", "-y", "out.jpg",
    ]);
  });
});

describe("extractPosterAt", () => {
  it("writes a non-empty jpg at the requested timestamp", async () => {
    const outPath = path.join(posterDir, "thumb-at.jpg");
    await extractPosterAt("tests/fixtures/sample.mp4", outPath, 0);
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.statSync(outPath).size).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    const outPath = path.join(posterDir, "missing-input.jpg");
    await expect(extractPosterAt("tests/fixtures/nope.mp4", outPath, 1)).rejects.toThrow();
  });
});

describe("normalizeImageToJpeg", () => {
  it("re-encodes an existing image to a non-empty jpg", async () => {
    const src = path.join(posterDir, "norm-src.jpg");
    await extractPosterAt("tests/fixtures/sample.mp4", src, 0);
    const out = path.join(posterDir, "norm-out.jpg");
    await normalizeImageToJpeg(src, out);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  }, 60_000);

  it("rejects when the input file does not exist", async () => {
    await expect(normalizeImageToJpeg("tests/fixtures/nope.png", path.join(posterDir, "x.jpg"))).rejects.toThrow();
  });
});
