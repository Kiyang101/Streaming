import path from "node:path";
import fs from "node:fs";

export function mediaRoot(): string {
  return path.join(process.cwd(), "media");
}
export function uploadPath(filename: string): string {
  return path.join(mediaRoot(), "uploads", filename);
}
export function vodDir(id: string): string {
  return path.join(mediaRoot(), "vod", id);
}
/** Relative path (for browser URLs) to a VOD master playlist. */
export function vodPlaylist(id: string): string {
  return `vod/${id}/master.m3u8`;
}
export function vodThumb(id: string): string {
  return path.join(mediaRoot(), "vod", id, "thumb.jpg");
}
/** Relative path (for browser URLs) to a VOD poster image. */
export function vodThumbRel(id: string): string {
  return `vod/${id}/thumb.jpg`;
}
/** Absolute path to a uniquely-named thumbnail for a VOD (cache-busting). */
export function vodThumbVersioned(id: string, ts: number): string {
  return path.join(mediaRoot(), "vod", id, `thumb-${ts}.jpg`);
}
/** Relative (browser-URL) path to a uniquely-named VOD thumbnail. */
export function vodThumbVersionedRel(id: string, ts: number): string {
  return `vod/${id}/thumb-${ts}.jpg`;
}
export function liveDir(key: string): string {
  return path.join(mediaRoot(), "live", key);
}
/** Relative path (for browser URLs) to a live playlist. */
export function livePlaylist(key: string): string {
  return `live/${key}/index.m3u8`;
}

export function uploadsDir(): string {
  return path.join(mediaRoot(), "uploads");
}

/**
 * Pure: given a list of filenames and an id, return the one whose stem (name
 * without extension) equals the id, else null. The upload route saves the
 * original as `<id>.<ext>`, so the stem uniquely identifies it.
 */
export function matchUploadFile(filenames: string[], id: string): string | null {
  for (const name of filenames) {
    const dot = name.lastIndexOf(".");
    const stem = dot === -1 ? name : name.slice(0, dot);
    if (stem === id) return name;
  }
  return null;
}

/** Absolute path to the original uploaded source for a video id, or null. */
export function findUpload(id: string): string | null {
  const dir = uploadsDir();
  if (!fs.existsSync(dir)) return null;
  const match = matchUploadFile(fs.readdirSync(dir), id);
  return match ? path.join(dir, match) : null;
}
