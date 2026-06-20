import { describe, it, expect } from "vitest";
import { segmentCount, upscalePercent, SEGMENT_SECONDS } from "@/lib/upscale";

describe("segmentCount", () => {
  it("ceils duration/segmentSeconds", () => {
    expect(segmentCount(30, 15)).toBe(2);
    expect(segmentCount(31, 15)).toBe(3);
  });
  it("is at least 1 even for tiny/zero durations", () => {
    expect(segmentCount(0, 15)).toBe(1);
    expect(segmentCount(2, 15)).toBe(1);
  });
  it("defaults to SEGMENT_SECONDS", () => {
    expect(segmentCount(SEGMENT_SECONDS * 3)).toBe(3);
  });
});

describe("upscalePercent", () => {
  it("maps segments-done to a percent capped at 99", () => {
    expect(upscalePercent(0, 4)).toBe(0);
    expect(upscalePercent(2, 4)).toBe(50);
    expect(upscalePercent(4, 4)).toBe(99); // 100 is emitted only after HLS completes
  });
  it("returns 0 for non-positive totals", () => {
    expect(upscalePercent(1, 0)).toBe(0);
  });
});
