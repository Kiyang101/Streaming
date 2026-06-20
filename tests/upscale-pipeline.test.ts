import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { upscaleVideoToHls } from "@/lib/upscale";

function hasRealesrgan(): boolean {
  const bin = process.env.REALESRGAN_PATH || "realesrgan-ncnn-vulkan";
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "upscale-out-"));
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe("upscaleVideoToHls", () => {
  it("rejects when the input file does not exist", async () => {
    await expect(upscaleVideoToHls("tests/fixtures/nope.mp4", outDir)).rejects.toThrow();
  });

  it.skipIf(!hasRealesrgan())(
    "produces a 4K master playlist from the sample and reports progress ending at 100",
    async () => {
      const progress: number[] = [];
      await upscaleVideoToHls("tests/fixtures/sample.mp4", outDir, (p) => progress.push(p));
      expect(fs.existsSync(path.join(outDir, "master.m3u8"))).toBe(true);
      expect(progress[progress.length - 1]).toBe(100);
      const master = fs.readFileSync(path.join(outDir, "master.m3u8"), "utf8");
      expect(master).toContain("RESOLUTION=3840x2160");
    },
    600_000,
  );
});
