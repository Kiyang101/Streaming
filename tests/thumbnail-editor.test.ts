import { describe, it, expect } from "vitest";
import { parseTimestamp } from "@/components/ThumbnailEditor";

describe("parseTimestamp", () => {
  it("parses plain seconds", () => {
    expect(parseTimestamp("90")).toBe(90);
  });
  it("parses mm:ss", () => {
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:05")).toBe(65);
  });
  it("trims surrounding whitespace", () => {
    expect(parseTimestamp("  2:00 ")).toBe(120);
  });
  it("returns null for empty or non-numeric input", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
  });
  it("returns null for more than two segments", () => {
    expect(parseTimestamp("1:2:3")).toBeNull();
  });
});
