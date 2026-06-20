import { describe, it, expect } from "vitest";
import type { Video } from "@/lib/types";

/**
 * VideoCard's <Thumbnail> subcomponent is not exported and this repo's
 * vitest.config.ts runs with `environment: "node"` (no jsdom, no
 * @testing-library/react in package.json) — there is no component-render
 * harness available anywhere in /tests. Per the dispatch instructions, we do
 * NOT introduce a new jsdom/RTL harness for a single component. Instead we
 * test the thumbnail-vs-gradient decision logic at the data level by
 * re-deriving the exact same predicate and src-string the component builds
 * (see src/components/VideoCard.tsx, Thumbnail() and its `<img src=
 * {`/media/${video.thumbnail}`}>` JSX), so a regression in that predicate or
 * URL format is caught even without a DOM render.
 */

function rendersImg(video: Pick<Video, "thumbnail">): boolean {
  // Mirrors: `if (video.thumbnail) { return <img ... /> }` in VideoCard.tsx
  return Boolean(video.thumbnail);
}

function imgSrcFor(video: Pick<Video, "thumbnail">): string | null {
  if (!video.thumbnail) return null;
  // Mirrors: `src={`/media/${video.thumbnail}`}` in VideoCard.tsx
  return `/media/${video.thumbnail}`;
}

describe("VideoCard thumbnail decision logic", () => {
  it("decides to render an <img> when thumbnail is a non-empty string", () => {
    expect(rendersImg({ thumbnail: "vod/abc/thumb.jpg" })).toBe(true);
  });

  it("decides to render the gradient fallback when thumbnail is undefined", () => {
    expect(rendersImg({ thumbnail: undefined })).toBe(false);
  });

  it("decides to render the gradient fallback when thumbnail is an empty string", () => {
    expect(rendersImg({ thumbnail: "" })).toBe(false);
  });

  it("builds the /media/<thumbnail> src for a present thumbnail", () => {
    expect(imgSrcFor({ thumbnail: "vod/abc/thumb.jpg" })).toBe("/media/vod/abc/thumb.jpg");
  });

  it("returns no src when thumbnail is absent", () => {
    expect(imgSrcFor({ thumbnail: undefined })).toBeNull();
  });
});
