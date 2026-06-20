import { describe, it, expect, beforeEach } from "vitest";
import { tryAcquire, release, activeUpscale } from "@/lib/upscaleLock";

beforeEach(() => {
  // Ensure a clean lock between tests.
  const a = activeUpscale();
  if (a) release(a);
});

describe("upscaleLock", () => {
  it("acquires when free and reports the active id", () => {
    expect(tryAcquire("a")).toBe(true);
    expect(activeUpscale()).toBe("a");
  });
  it("refuses a second acquire while held", () => {
    expect(tryAcquire("a")).toBe(true);
    expect(tryAcquire("b")).toBe(false);
    expect(activeUpscale()).toBe("a");
  });
  it("release frees the lock only for the holder", () => {
    tryAcquire("a");
    release("b"); // not the holder — no-op
    expect(activeUpscale()).toBe("a");
    release("a");
    expect(activeUpscale()).toBeNull();
    expect(tryAcquire("b")).toBe(true);
  });
});
