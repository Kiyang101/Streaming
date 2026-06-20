import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface Rendition {
  width: number;
  height: number;
  bitrate: string; // ffmpeg bitrate string, e.g. "2800k"
}

export const DEFAULT_LADDER: Rendition[] = [
  { width: 1280, height: 720, bitrate: "2800k" },
  { width: 854, height: 480, bitrate: "1400k" },
];

export const UHD_LADDER: Rendition[] = [
  { width: 3840, height: 2160, bitrate: "16000k" },
  { width: 1920, height: 1080, bitrate: "5000k" },
  { width: 1280, height: 720, bitrate: "2800k" },
];

/**
 * Build the ffmpeg argument list that produces an HLS ABR ladder from the given
 * renditions. Pure (no I/O) so it can be unit-tested. The default ladder
 * reproduces the original hardcoded 720p/480p command exactly.
 */
export function buildHlsArgs(inputPath: string, outDir: string, ladder: Rendition[]): string[] {
  const n = ladder.length;
  const labels = ladder.map((_, i) => `[v${i}]`).join("");
  const scales = ladder
    .map((r, i) => `[v${i}]scale=w=${r.width}:h=${r.height}[v${i}out]`)
    .join(";");
  const filterComplex = `[0:v]split=${n}${labels};${scales}`;

  const videoMaps: string[] = [];
  for (let i = 0; i < n; i++) {
    videoMaps.push("-map", `[v${i}out]`, `-c:v:${i}`, "libx264", `-b:v:${i}`, ladder[i].bitrate);
  }

  const audioMaps: string[] = [];
  for (let i = 0; i < n; i++) audioMaps.push("-map", "a:0?");
  audioMaps.push("-c:a", "aac", "-b:a", "128k");

  const varStreamMap = ladder.map((_, i) => `v:${i},a:${i}`).join(" ");

  return [
    "-y",
    "-i", inputPath,
    "-filter_complex", filterComplex,
    ...videoMaps,
    ...audioMaps,
    "-f", "hls",
    "-hls_time", "4",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", path.join(outDir, "v%v_%03d.ts"),
    "-master_pl_name", "master.m3u8",
    "-var_stream_map", varStreamMap,
    path.join(outDir, "v%v.m3u8"),
  ];
}

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
  ladder: Rendition[] = DEFAULT_LADDER,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputPath)) {
      reject(new Error(`input not found: ${inputPath}`));
      return;
    }
    fs.mkdirSync(outDir, { recursive: true });

    // %v expands to the variant index into per-variant dirs; arg list is built
    // from the rendition ladder (default ladder reproduces the original command).
    const args = buildHlsArgs(inputPath, outDir, ladder);

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
