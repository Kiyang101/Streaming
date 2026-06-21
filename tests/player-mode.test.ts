// tests/player-mode.test.ts
import { describe, it, expect } from "vitest";
import { usesHlsPipeline } from "@/components/Player";

/** Player exports a pure helper for the mode branch so the hls.js-vs-direct-file
 *  decision can be unit-tested in the node env (no DOM), mirroring videoFitClass. */
describe("usesHlsPipeline", () => {
  it("uses the hls.js pipeline for hls mode (the default)", () => {
    expect(usesHlsPipeline("hls")).toBe(true);
  });
  it("bypasses the hls.js pipeline for direct file playback", () => {
    expect(usesHlsPipeline("file")).toBe(false);
  });
});
