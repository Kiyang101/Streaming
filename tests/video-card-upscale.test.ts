import { describe, it, expect } from "vitest";
import { upscaleAction } from "@/components/VideoCard";
import type { Video } from "@/lib/types";

const base: Pick<Video, "status" | "upscaleStatus" | "upscaleProgress"> = {
  status: "ready",
};

describe("upscaleAction", () => {
  it("offers the button for a ready, not-yet-upscaled video", () => {
    expect(upscaleAction(base)).toEqual({ kind: "button" });
    expect(upscaleAction({ ...base, upscaleStatus: "none" })).toEqual({ kind: "button" });
    expect(upscaleAction({ ...base, upscaleStatus: "failed" })).toEqual({ kind: "button" });
  });
  it("shows progress while upscaling, clamped 0–100", () => {
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling", upscaleProgress: 40 })).toEqual({ kind: "progress", pct: 40 });
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling", upscaleProgress: 250 })).toEqual({ kind: "progress", pct: 100 });
    expect(upscaleAction({ ...base, upscaleStatus: "upscaling" })).toEqual({ kind: "progress", pct: 0 });
  });
  it("shows the 4K badge once upscaled", () => {
    expect(upscaleAction({ ...base, upscaleStatus: "upscaled" })).toEqual({ kind: "badge" });
  });
  it("offers nothing for non-ready videos", () => {
    expect(upscaleAction({ status: "processing" })).toEqual({ kind: "none" });
    expect(upscaleAction({ status: "failed" })).toEqual({ kind: "none" });
  });
});
