import { describe, it, expect } from "vitest";
import { newId } from "@/lib/ids";

describe("newId", () => {
  it("returns a non-empty unique-ish string", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});
