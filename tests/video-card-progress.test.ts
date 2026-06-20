import { describe, it, expect } from "vitest";
import { progressDisplay } from "@/components/VideoCard";
import type { Video } from "@/lib/types";

/**
 * VideoCard's <ProgressBar> subcomponent is not exported and this repo's
 * vitest.config.ts runs with `environment: "node"` (no jsdom, no
 * @testing-library/react in package.json) — there is no component-render
 * harness available anywhere in /tests (see tests/video-card-thumbnail.test.ts
 * for the established pattern). Unlike the thumbnail logic, the coder
 * factored the progress decision out into an exported pure helper,
 * `progressDisplay()`, so we test it directly rather than re-deriving it.
 */

type ProgressInput = Pick<Video, "status" | "progress">;

describe("VideoCard progressDisplay", () => {
  it("shows a percent when status is processing and progress is a number", () => {
    const result = progressDisplay({ status: "processing", progress: 42 } as ProgressInput);
    expect(result).toEqual({ kind: "percent", pct: 42 });
  });

  it("shows no progress UI when status is ready", () => {
    const result = progressDisplay({ status: "ready", progress: 50 } as ProgressInput);
    expect(result).toEqual({ kind: "none" });
  });

  it("shows no progress UI when status is failed", () => {
    const result = progressDisplay({ status: "failed", progress: 50 } as ProgressInput);
    expect(result).toEqual({ kind: "none" });
  });

  it("shows an indeterminate state when status is processing and progress is undefined", () => {
    const result = progressDisplay({ status: "processing", progress: undefined } as ProgressInput);
    expect(result).toEqual({ kind: "indeterminate" });
  });

  it("clamps a progress value above 100 to 100", () => {
    const result = progressDisplay({ status: "processing", progress: 150 } as ProgressInput);
    expect(result).toEqual({ kind: "percent", pct: 100 });
  });

  it("clamps a negative progress value to 0", () => {
    const result = progressDisplay({ status: "processing", progress: -10 } as ProgressInput);
    expect(result).toEqual({ kind: "percent", pct: 0 });
  });

  it("treats progress 0 as a determinate percent, not indeterminate", () => {
    const result = progressDisplay({ status: "processing", progress: 0 } as ProgressInput);
    expect(result).toEqual({ kind: "percent", pct: 0 });
  });
});
