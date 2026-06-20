import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { probeDuration, transcodeToHls, UHD_LADDER } from "./transcode";

export const SEGMENT_SECONDS = 15;

/** Number of fixed-length segments a video of `durationSeconds` splits into. */
export function segmentCount(durationSeconds: number, segmentSeconds = SEGMENT_SECONDS): number {
  return Math.max(1, Math.ceil(durationSeconds / segmentSeconds));
}

/**
 * Segment-granularity progress for the upscale (frame) phase, capped at 99 so
 * the final 100 is reserved for after the HLS transcode finishes.
 */
export function upscalePercent(segmentsDone: number, totalSegments: number): number {
  if (totalSegments <= 0) return 0;
  return Math.min(99, Math.round((segmentsDone / totalSegments) * 100));
}

const REALESRGAN = process.env.REALESRGAN_PATH || "realesrgan-ncnn-vulkan";
const REALESRGAN_MODEL = process.env.REALESRGAN_MODEL || "realesrgan-x4plus";

/** Run a child process to completion; reject on error / non-zero exit. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Probe a video's average frame rate as a number (e.g. 24, 29.97). */
function probeFps(input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate",
      "-of", "default=nw=1:nk=1",
      input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe fps exited ${code}`));
      const [num, den] = out.trim().split("/");
      const fps = Number(num) / (Number(den) || 1);
      resolve(Number.isFinite(fps) && fps > 0 ? fps : 24);
    });
  });
}

/**
 * AI-upscale `inputPath` to a 4K HLS ladder written to `outDir`.
 *
 * Pipeline: split into ~15s segments → per segment {extract PNG frames →
 * realesrgan ×4 → reassemble at 3840×2160} → concat to a 4K master → HLS
 * transcode (UHD ladder). All scratch work happens in a sibling temp dir on the
 * SAME filesystem as `outDir`; the finished ladder is built in a staging dir and
 * atomically renamed into `outDir` so playback never observes a partial result
 * (and the existing playable ladder in `outDir` is left untouched until the
 * swap). Progress is segment-granular (0–99), with 100 emitted once the HLS
 * transcode completes.
 */
export async function upscaleVideoToHls(
  inputPath: string,
  outDir: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!fs.existsSync(inputPath)) throw new Error(`input not found: ${inputPath}`);

  // Scratch dir is a sibling of outDir (e.g. media/vod/.tmp-<id>) so the final
  // rename into outDir is a same-filesystem, atomic operation.
  const work = path.join(path.dirname(outDir), `.tmp-${path.basename(outDir)}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const segIn = path.join(work, "segin");
  const segOut = path.join(work, "segout");
  fs.mkdirSync(segIn, { recursive: true });
  fs.mkdirSync(segOut, { recursive: true });

  try {
    const duration = await probeDuration(inputPath).catch(() => 0);
    const total = segmentCount(duration);

    // 1) Split source into ~15s segments (stream copy: fast, splits on keyframes).
    await run("ffmpeg", [
      "-y", "-i", inputPath,
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(SEGMENT_SECONDS),
      "-reset_timestamps", "1",
      path.join(segIn, "seg_%03d.mp4"),
    ]);

    const segFiles = fs.readdirSync(segIn).filter((f) => f.endsWith(".mp4")).sort();
    onProgress?.(0);

    // 2) Upscale each segment, deleting its frames before moving on (bounds disk).
    for (let i = 0; i < segFiles.length; i++) {
      const seg = path.join(segIn, segFiles[i]);
      const frames = path.join(work, `frames_${i}`);
      const upFrames = path.join(work, `up_${i}`);
      fs.mkdirSync(frames, { recursive: true });
      fs.mkdirSync(upFrames, { recursive: true });

      const fps = await probeFps(seg);

      // Extract frames as PNG.
      await run("ffmpeg", ["-y", "-i", seg, path.join(frames, "%06d.png")]);

      // Real-ESRGAN ×4 over the whole frames directory.
      const esrganArgs = ["-i", frames, "-o", upFrames, "-n", REALESRGAN_MODEL, "-s", "4"];
      if (process.env.REALESRGAN_MODELS) esrganArgs.push("-m", process.env.REALESRGAN_MODELS);
      await run(REALESRGAN, esrganArgs);

      // Reassemble upscaled frames → 3840×2160, muxing the segment's own audio.
      await run("ffmpeg", [
        "-y",
        "-framerate", String(fps),
        "-i", path.join(upFrames, "%06d.png"),
        "-i", seg,
        "-map", "0:v", "-map", "1:a?",
        "-vf", "scale=3840:2160:flags=lanczos",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        path.join(segOut, `up_${String(i).padStart(3, "0")}.mp4`),
      ]);

      // Free this segment's frames before the next iteration.
      fs.rmSync(frames, { recursive: true, force: true });
      fs.rmSync(upFrames, { recursive: true, force: true });

      onProgress?.(upscalePercent(i + 1, total));
    }

    // 3) Concat upscaled segments into a single 4K master.
    const upSegs = fs.readdirSync(segOut).filter((f) => f.endsWith(".mp4")).sort();
    const listFile = path.join(work, "concat.txt");
    fs.writeFileSync(listFile, upSegs.map((f) => `file '${path.join(segOut, f)}'`).join("\n"));
    const master4k = path.join(work, "master4k.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", master4k]);

    // 4) HLS transcode with the UHD ladder into a staging dir.
    const staging = path.join(work, "hls");
    await transcodeToHls(master4k, staging, undefined, UHD_LADDER);

    // 5) Atomically replace outDir with the staged ladder. staging is inside
    //    `work`, a sibling of outDir on the same filesystem, so rename is atomic.
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(staging, outDir);

    onProgress?.(100);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
