export type VideoStatus = "processing" | "ready" | "failed";
export type VideoType = "vod" | "live";

export interface Video {
  id: string;
  title: string;
  type: VideoType;
  status: VideoStatus;
  path: string; // relative media path to the master playlist, e.g. "vod/<id>/master.m3u8"
  createdAt: number;
  thumbnail?: string; // relative media path to the poster image, e.g. "vod/<id>/thumb.jpg"
  progress?: number; // whole-number transcode percent (0–100); NULL until first update
}
