// tests/local-queue.test.ts
import { describe, it, expect } from "vitest";
import { localQueueReducer, type LocalQueueState, type LocalQueueItem } from "@/lib/localQueue";

const item = (id: string, status: LocalQueueItem["status"] = "ready"): LocalQueueItem => ({
  id,
  name: `${id}.mp4`,
  size: 0,
  status,
});

const empty: LocalQueueState = { items: [], activeId: null };

describe("localQueueReducer — add", () => {
  it("appends added items and activates the first when queue was empty", () => {
    const next = localQueueReducer(empty, { type: "add", items: [item("a"), item("b")] });
    expect(next.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.activeId).toBe("a");
  });

  it("keeps the existing active item when adding to a non-empty queue", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    const next = localQueueReducer(start, { type: "add", items: [item("b")] });
    expect(next.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.activeId).toBe("a");
  });
});
