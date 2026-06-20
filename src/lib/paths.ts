import path from "node:path";

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
export function liveDir(key: string): string {
  return path.join(mediaRoot(), "live", key);
}
/** Relative path (for browser URLs) to a live playlist. */
export function livePlaylist(key: string): string {
  return `live/${key}/index.m3u8`;
}
