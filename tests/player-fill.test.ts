import { describe, it, expect } from "vitest";
import { videoFitClass, parseFillMode } from "@/components/Player";

/**
 * Player keeps the zoom-to-fill logic in two exported pure helpers so they can
 * be unit-tested without a DOM render (vitest runs `environment: "node"`),
 * mirroring the `progressDisplay` / `upscaleAction` pattern elsewhere.
 */

describe("videoFitClass", () => {
  it("uses object-cover (crop to fill) when fill mode is on", () => {
    expect(videoFitClass(true)).toBe("object-cover");
  });
  it("uses object-contain (letterbox/fit) when fill mode is off", () => {
    expect(videoFitClass(false)).toBe("object-contain");
  });
});

describe("parseFillMode", () => {
  it("treats the persisted 'fill' value as on", () => {
    expect(parseFillMode("fill")).toBe(true);
  });
  it("treats anything else (including null/empty) as off", () => {
    expect(parseFillMode("fit")).toBe(false);
    expect(parseFillMode(null)).toBe(false);
    expect(parseFillMode("")).toBe(false);
    expect(parseFillMode("true")).toBe(false);
  });
});
