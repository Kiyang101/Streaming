export type HlsStrategy = "hlsjs" | "native" | "unsupported";

/**
 * Decide how to play an HLS source.
 *
 * hls.js is preferred whenever it is supported — all desktop browsers and embedded
 * Chromium webviews provide it via Media Source Extensions. This matters because some
 * environments (e.g. VS Code's Simple Browser) report native HLS support as "maybe"
 * yet cannot actually decode an HLS playlist; taking the native path there yields a
 * black, non-playing video. Native HLS is used only as a fallback where hls.js cannot
 * run (notably iOS Safari, which lacks MSE).
 *
 * @param hlsSupported   result of Hls.isSupported()
 * @param nativeCanPlay  result of video.canPlayType("application/vnd.apple.mpegurl")
 *                       ("" | "maybe" | "probably")
 */
export function selectHlsStrategy(hlsSupported: boolean, nativeCanPlay: string): HlsStrategy {
  if (hlsSupported) return "hlsjs";
  if (nativeCanPlay === "probably" || nativeCanPlay === "maybe") return "native";
  return "unsupported";
}
