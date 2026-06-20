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
