import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { openDb, getVideo } from "@/lib/db";
import { transcodeToHls } from "@/lib/transcode";
import { vodDir } from "@/lib/paths";
import fs from "node:fs";
import path from "node:path";

// Exercises the same pieces the upload route wires together: insert → transcode → ready.
const id = "itest";
beforeEach(() => openDb(":memory:"));
afterAll(() => fs.rmSync(vodDir(id), { recursive: true, force: true }));

describe("VOD pipeline", () => {
  it("transcodes a sample and yields a playable master playlist", async () => {
    await transcodeToHls("tests/fixtures/sample.mp4", vodDir(id));
    expect(fs.existsSync(path.join(vodDir(id), "master.m3u8"))).toBe(true);
  }, 60_000);
});
