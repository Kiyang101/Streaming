import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Transcode an input video into an HLS adaptive-bitrate ladder (720p + 480p)
 * written to outDir. Resolves on success, rejects on non-zero exit / missing input.
 */
export function transcodeToHls(inputPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }
    fs.mkdirSync(outDir, { recursive: true });

    // Two renditions; %v expands to the variant index (0,1) into per-variant dirs.
    const args = [
      "-y",
      "-i", inputPath,
      "-filter_complex", "[0:v]split=2[v0][v1];[v0]scale=w=1280:h=720[v0out];[v1]scale=w=854:h=480[v1out]",
      "-map", "[v0out]", "-c:v:0", "libx264", "-b:v:0", "2800k",
      "-map", "[v1out]", "-c:v:1", "libx264", "-b:v:1", "1400k",
      "-map", "a:0?", "-map", "a:0?", "-c:a", "aac", "-b:a", "128k",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(outDir, "v%v_%03d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", "v:0,a:0 v:1,a:1",
      path.join(outDir, "v%v.m3u8"),
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}
