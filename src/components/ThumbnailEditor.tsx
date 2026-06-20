"use client";
import { useState } from "react";
import type { Video } from "@/lib/types";

/** Parse a "mm:ss" or plain-seconds string into a non-negative second count.
 *  Returns null for empty / non-numeric / >2-segment input. Pure (unit-tested). */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 2) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds;
}

type Tab = "upload" | "frame";

/** Modal for replacing a VOD's thumbnail, by image upload or by frame-grab.
 *  `defaultTimestamp` (seconds) pre-fills the frame tab from the watch player. */
export default function ThumbnailEditor({
  video,
  defaultTimestamp,
  onClose,
  onChanged,
}: {
  video: Video;
  defaultTimestamp?: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [tsText, setTsText] = useState(
    defaultTimestamp != null ? String(Math.floor(defaultTimestamp)) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(makeRequest: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await makeRequest();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update thumbnail.");
        return;
      }
      onChanged?.();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submitUpload() {
    if (!file) {
      setError("Choose an image first.");
      return;
    }
    const form = new FormData();
    form.append("image", file);
    void send(() => fetch(`/api/videos/${video.id}/thumbnail`, { method: "POST", body: form }));
  }

  function submitFrame() {
    const seconds = parseTimestamp(tsText);
    if (seconds == null) {
      setError("Enter a time like 1:30 or 90.");
      return;
    }
    void send(() =>
      fetch(`/api/videos/${video.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: seconds }),
      }),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Change thumbnail"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-yt-surface p-5 text-yt-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Change thumbnail</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-yt-subtext hover:text-yt-text">
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`rounded-full px-3 py-1 text-sm ${tab === "upload" ? "bg-yt-red text-white" : "bg-yt-bg text-yt-subtext"}`}
          >
            Upload image
          </button>
          <button
            type="button"
            onClick={() => setTab("frame")}
            className={`rounded-full px-3 py-1 text-sm ${tab === "frame" ? "bg-yt-red text-white" : "bg-yt-bg text-yt-subtext"}`}
          >
            From video
          </button>
        </div>

        {tab === "upload" ? (
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-yt-subtext"
            />
            <button
              type="button"
              onClick={submitUpload}
              disabled={busy}
              className="rounded-full bg-yt-red px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save thumbnail"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm text-yt-subtext">
              Timestamp (mm:ss or seconds)
              <input
                type="text"
                value={tsText}
                onChange={(e) => setTsText(e.target.value)}
                placeholder="1:30"
                className="mt-1 block w-full rounded-md bg-yt-bg px-3 py-1.5 text-sm text-yt-text outline-none"
              />
            </label>
            <button
              type="button"
              onClick={submitFrame}
              disabled={busy}
              className="rounded-full bg-yt-red px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Use this frame"}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-yt-red">{error}</p>}
      </div>
    </div>
  );
}
