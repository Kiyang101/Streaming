import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Probe the duration (in seconds) of an input video via ffprobe.
 * Resolves a positive number; rejects on missing input / non-zero exit / NaN.
 */
export function probeDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }

    const args = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      inputPath,
    ];

    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const duration = parseFloat(stdout.trim());
      if (Number.isNaN(duration)) {
        reject(new Error(`ffprobe returned non-numeric duration: ${stdout.trim()}`));
        return;
      }
      resolve(duration);
    });
  });
}

/**
 * Transcode an input video into an HLS adaptive-bitrate ladder (720p + 480p)
 * written to outDir. Resolves on success, rejects on non-zero exit / missing input.
 *
 * When `onProgress` is supplied, a true transcode percentage (0–100) is computed
 * from ffmpeg's `-progress` output and reported as it advances. Progress is
 * advisory: if duration probing fails, transcoding still proceeds normally and
 * `onProgress` is simply never called with a computed value.
 */
export function transcodeToHls(
  inputPath: string,
  outDir: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
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

    const run = (duration: number | null) => {
      // Emit computed progress over stdout only when onProgress + a valid duration exist.
      const reportProgress = Boolean(onProgress) && duration !== null && duration > 0;
      if (reportProgress) {
        // ffmpeg writes machine-readable `key=value` lines to stdout via -progress.
        args.unshift("-progress", "pipe:1");
      }

      const proc = spawn("ffmpeg", args, {
        stdio: reportProgress ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "pipe"],
      });

      let stderr = "";
      proc.stderr!.on("data", (d) => (stderr += d.toString()));

      if (reportProgress) {
        let lastPercent = -1;
        let stdoutBuf = "";
        proc.stdout!.on("data", (d) => {
          stdoutBuf += d.toString();
          // Process complete lines; keep any partial trailing line buffered.
          let nl: number;
          while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
            const line = stdoutBuf.slice(0, nl).trim();
            stdoutBuf = stdoutBuf.slice(nl + 1);
            const m = line.match(/^out_time_us=(\d+)/);
            if (!m) continue;
            const outTimeUs = Number(m[1]);
            const percent = Math.min(99, Math.round((outTimeUs / 1e6) / duration! * 100));
            // Throttle: only emit on a strictly increasing whole-number percent.
            if (percent > lastPercent) {
              lastPercent = percent;
              onProgress!(percent);
            }
          }
        });
      }

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          if (reportProgress) onProgress!(100);
          resolve();
        } else {
          reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
        }
      });
    };

    if (onProgress) {
      // Probe duration first; on failure, degrade gracefully to a no-progress transcode.
      probeDuration(inputPath)
        .then((duration) => run(duration))
        .catch(() => run(null));
    } else {
      run(null);
    }
  });
}

/**
 * Extract a single poster frame (~1s in) from an input video to outPath as a
 * JPEG. Resolves on success, rejects on non-zero exit / missing input.
 */
export function extractPoster(inputPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const args = [
      "-ss", "00:00:01",
      "-i", inputPath,
      "-frames:v", "1",
      "-y", outPath,
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
