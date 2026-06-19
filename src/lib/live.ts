import fs from "node:fs";
import path from "node:path";
import { liveDir } from "@/lib/paths";

/** A stream is "live" if its HLS playlist currently exists on disk. */
export function isLive(key: string): boolean {
  return fs.existsSync(path.join(liveDir(key), "index.m3u8"));
}
