import { describe, it, expect } from "vitest";
import { checkUpscaleEligibility } from "@/lib/upscaleEligibility";
import type { Video } from "@/lib/types";

const ready: Video = { id: "a", title: "A", type: "vod", status: "ready", path: "vod/a/master.m3u8", createdAt: 1 };

describe("checkUpscaleEligibility", () => {
  it("404 when the video is missing", () => {
    expect(checkUpscaleEligibility(undefined, false)).toEqual({ ok: false, status: 404, error: "not found" });
  });
  it("409 when the video is not ready", () => {
    expect(checkUpscaleEligibility({ ...ready, status: "processing" }, false))
      .toEqual({ ok: false, status: 409, error: "video not ready" });
  });
  it("409 when already upscaling or upscaled", () => {
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "upscaling" }, false).status).toBe(409);
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "upscaled" }, false).status).toBe(409);
  });
  it("409 when another upscale is running (locked)", () => {
    expect(checkUpscaleEligibility(ready, true))
      .toEqual({ ok: false, status: 409, error: "another upscale is running" });
  });
  it("ok for a ready, not-yet-upscaled video when unlocked", () => {
    expect(checkUpscaleEligibility(ready, false)).toEqual({ ok: true });
    expect(checkUpscaleEligibility({ ...ready, upscaleStatus: "failed" }, false)).toEqual({ ok: true });
  });
});
