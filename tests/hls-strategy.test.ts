import { describe, it, expect } from "vitest";
import { selectHlsStrategy } from "@/lib/hlsStrategy";

describe("selectHlsStrategy", () => {
  // Root-cause bug: some browsers (e.g. VS Code's embedded webview) report native
  // HLS as "maybe" but cannot actually decode it. When hls.js is available we must
  // prefer it; the old native-first logic produced a black, non-playing video.
  it("prefers hls.js when supported, even if native HLS claims 'maybe'", () => {
    expect(selectHlsStrategy(true, "maybe")).toBe("hlsjs");
  });
  it("prefers hls.js when supported and native reports empty", () => {
    expect(selectHlsStrategy(true, "")).toBe("hlsjs");
  });
  it("falls back to native HLS when hls.js is unsupported (iOS Safari)", () => {
    expect(selectHlsStrategy(false, "probably")).toBe("native");
    expect(selectHlsStrategy(false, "maybe")).toBe("native");
  });
  it("reports unsupported when neither hls.js nor native can play", () => {
    expect(selectHlsStrategy(false, "")).toBe("unsupported");
  });
});
