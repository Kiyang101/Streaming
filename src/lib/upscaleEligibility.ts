import type { Video } from "./types";

export type UpscaleEligibility =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Pure decision: may this video start an upscale right now? */
export function checkUpscaleEligibility(video: Video | undefined, locked: boolean): UpscaleEligibility {
  if (!video) return { ok: false, status: 404, error: "not found" };
  if (video.status !== "ready") return { ok: false, status: 409, error: "video not ready" };
  if (video.upscaleStatus === "upscaling") return { ok: false, status: 409, error: "already upscaling" };
  if (video.upscaleStatus === "upscaled") return { ok: false, status: 409, error: "already upscaled" };
  if (locked) return { ok: false, status: 409, error: "another upscale is running" };
  return { ok: true };
}
