export type VideoStatus = "processing" | "ready" | "failed";
export type VideoType = "vod" | "live";

export interface Video {
  id: string;
  title: string;
  type: VideoType;
  status: VideoStatus;
  path: string; // relative media path to the master playlist, e.g. "vod/<id>/master.m3u8"
  createdAt: number;
}
