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

describe("localQueueReducer — remove", () => {
  it("removing a non-active item leaves active unchanged", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "a" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.items.map((i) => i.id)).toEqual(["a"]);
    expect(next.activeId).toBe("a");
  });

  it("removing the active item advances active to the item at the same index", () => {
    const start: LocalQueueState = { items: [item("a"), item("b"), item("c")], activeId: "b" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(next.activeId).toBe("c");
  });

  it("removing the active last item falls back to the new last item", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "b" };
    const next = localQueueReducer(start, { type: "remove", id: "b" });
    expect(next.activeId).toBe("a");
  });

  it("removing the only item clears active", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    const next = localQueueReducer(start, { type: "remove", id: "a" });
    expect(next.items).toEqual([]);
    expect(next.activeId).toBeNull();
  });
});

describe("localQueueReducer — setActive / setStatus / clear", () => {
  it("setActive switches to an existing item", () => {
    const start: LocalQueueState = { items: [item("a"), item("b")], activeId: "a" };
    expect(localQueueReducer(start, { type: "setActive", id: "b" }).activeId).toBe("b");
  });

  it("setActive ignores an unknown id", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    expect(localQueueReducer(start, { type: "setActive", id: "zzz" }).activeId).toBe("a");
  });

  it("setStatus updates only the targeted item", () => {
    const start: LocalQueueState = { items: [item("a", "saved"), item("b", "saved")], activeId: "a" };
    const next = localQueueReducer(start, { type: "setStatus", id: "a", status: "ready" });
    expect(next.items.find((i) => i.id === "a")?.status).toBe("ready");
    expect(next.items.find((i) => i.id === "b")?.status).toBe("saved");
  });

  it("clear empties the queue", () => {
    const start: LocalQueueState = { items: [item("a")], activeId: "a" };
    expect(localQueueReducer(start, { type: "clear" })).toEqual({ items: [], activeId: null });
  });
});
