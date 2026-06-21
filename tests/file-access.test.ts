// tests/file-access.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { supportsFileSystemAccess } from "@/lib/fileAccess";

// vitest runs in the node env where `window` is undefined; stub it per-case.
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("supportsFileSystemAccess", () => {
  it("is false when window is undefined (SSR / node)", () => {
    expect(supportsFileSystemAccess()).toBe(false);
  });
  it("is false when window lacks showOpenFilePicker (e.g. VS Code Simple Browser)", () => {
    (globalThis as Record<string, unknown>).window = {};
    expect(supportsFileSystemAccess()).toBe(false);
  });
  it("is true when showOpenFilePicker is present", () => {
    (globalThis as Record<string, unknown>).window = { showOpenFilePicker: () => {} };
    expect(supportsFileSystemAccess()).toBe(true);
  });
});
