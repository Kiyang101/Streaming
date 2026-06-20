"use client";
import Link from "next/link";
import { useState } from "react";
import type { Video, VideoStatus, UpscaleStatus } from "@/lib/types";
import ThumbnailEditor from "@/components/ThumbnailEditor";

/**
 * A single YouTube-style video card for the home grid.
 *
 * The `Video` type has no thumbnail URL, so the thumbnail is rendered as a
 * branded CSS gradient block (never a broken <img>). A deterministic gradient
 * is derived from the video id so each card looks distinct but stable across
 * the 4s polling refresh.
 *
 * Only "ready" videos link to the watch page; "processing"/"failed" videos
 * render as a non-interactive card so users can't navigate to an unplayable
 * stream.
 */

const STATUS_BADGE: Record<VideoStatus, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-yt-red text-white" },
  processing: { label: "Processing", className: "bg-yt-surface text-yt-subtext" },
  failed: { label: "Failed", className: "bg-yt-surface text-yt-red" },
};

// Fixed palette of gradient pairs; index chosen deterministically from the id
// so a given video always gets the same placeholder thumbnail.
const GRADIENTS = [
  "from-red-700 to-purple-800",
  "from-blue-700 to-cyan-700",
  "from-emerald-700 to-teal-800",
  "from-orange-600 to-rose-700",
  "from-indigo-700 to-fuchsia-800",
  "from-slate-600 to-slate-900",
] as const;

function gradientFor(id: string): string {
  // Simple, stable string hash → palette index.
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function Thumbnail({ video }: { video: Video }) {
  const initial = video.title.trim().charAt(0).toUpperCase() || "?";
  if (video.thumbnail) {
    return (
      <img
        src={`/media/${video.thumbnail}`}
        alt={video.title}
        loading="lazy"
        className="aspect-video w-full rounded-xl object-cover"
      />
    );
  }
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-xl bg-gradient-to-br ${gradientFor(
        video.id,
      )}`}
      aria-hidden="true"
    >
      <span className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-white/90">
        {initial}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: VideoStatus }) {
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.processing;
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

/**
 * Pure decision for the processing-card progress UI, factored out so it can be
 * unit-tested without a DOM render (vitest runs `environment: "node"`):
 *  - non-processing status        → no progress UI ({ kind: "none" })
 *  - processing + numeric progress → determinate bar ({ kind: "percent", pct })
 *  - processing + null/undefined   → indeterminate "Processing…" bar
 */
export type ProgressDisplay =
  | { kind: "none" }
  | { kind: "percent"; pct: number }
  | { kind: "indeterminate" };

export function progressDisplay(video: Pick<Video, "status" | "progress">): ProgressDisplay {
  if (video.status !== "processing") return { kind: "none" };
  if (typeof video.progress === "number") {
    // Clamp to a sane 0–100 range so a stray DB value can't overflow the bar.
    const pct = Math.max(0, Math.min(100, video.progress));
    return { kind: "percent", pct };
  }
  return { kind: "indeterminate" };
}

export type UpscaleAction =
  | { kind: "none" }
  | { kind: "button" }
  | { kind: "progress"; pct: number }
  | { kind: "badge" };

/**
 * Pure decision for the per-card upscale control, factored out for unit testing
 * (vitest runs `environment: "node"`):
 *  - non-ready video                 → no control
 *  - ready + none/failed/undefined   → "Upscale to 4K" button
 *  - upscaling                       → progress bar (clamped 0–100)
 *  - upscaled                        → "4K" badge
 */
export function upscaleAction(
  video: Pick<Video, "status" | "upscaleStatus" | "upscaleProgress">,
): UpscaleAction {
  if (video.status !== "ready") return { kind: "none" };
  if (video.upscaleStatus === "upscaling") {
    const pct = Math.max(0, Math.min(100, video.upscaleProgress ?? 0));
    return { kind: "progress", pct };
  }
  if (video.upscaleStatus === "upscaled") return { kind: "badge" };
  return { kind: "button" };
}

function ProgressBar({ video }: { video: Video }) {
  const display = progressDisplay(video);
  if (display.kind === "none") return null;

  if (display.kind === "percent") {
    return (
      <div className="mt-2">
        <div
          className="h-2 w-full overflow-hidden rounded bg-yt-bg"
          role="progressbar"
          aria-valuenow={display.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Transcoding ${video.title}: ${display.pct}%`}
        >
          <div
            className="h-full bg-yt-red transition-all"
            style={{ width: `${display.pct}%` }}
          />
        </div>
        <span className="mt-1 block text-xs text-yt-subtext">{display.pct}%</span>
      </div>
    );
  }

  // Indeterminate: animated bar, no number.
  return (
    <div className="mt-2">
      <div
        className="h-2 w-full overflow-hidden rounded bg-yt-bg"
        role="progressbar"
        aria-label={`Processing ${video.title}`}
      >
        <div className="h-full w-1/3 animate-pulse bg-yt-red" />
      </div>
      <span className="mt-1 block text-xs text-yt-subtext">Processing…</span>
    </div>
  );
}

function UpscaleControl({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const action = upscaleAction(video);

  if (action.kind === "none") return null;

  if (action.kind === "badge") {
    return (
      <span className="mt-2 inline-block rounded-full bg-yt-red px-2 py-0.5 text-xs font-medium text-white">
        4K
      </span>
    );
  }

  if (action.kind === "progress") {
    return (
      <div className="mt-2">
        <div
          className="h-2 w-full overflow-hidden rounded bg-yt-bg"
          role="progressbar"
          aria-valuenow={action.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Upscaling ${video.title}: ${action.pct}%`}
        >
          <div className="h-full bg-yt-red transition-all" style={{ width: `${action.pct}%` }} />
        </div>
        <span className="mt-1 block text-xs text-yt-subtext">Upscaling… {action.pct}%</span>
      </div>
    );
  }

  // action.kind === "button"
  async function start(e: React.MouseEvent) {
    e.preventDefault(); // don't trigger the card's watch link
    e.stopPropagation();
    setBusy(true);
    try {
      await fetch(`/api/videos/${video.id}/upscale`, { method: "POST" });
    } finally {
      setBusy(false);
      onChanged?.();
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      className="mt-2 rounded-full border border-yt-surface px-3 py-1 text-xs font-medium text-yt-text transition-colors hover:bg-yt-surface disabled:opacity-50"
    >
      {busy ? "Starting…" : "Upscale to 4K"}
    </button>
  );
}

export default function VideoCard({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const [editing, setEditing] = useState(false);

  const body = (
    <>
      <Thumbnail video={video} />
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-yt-text">{video.title}</h3>
        <StatusBadge status={video.status} />
      </div>
      <ProgressBar video={video} />
      <UpscaleControl video={video} onChanged={onChanged} />
      {video.type === "vod" && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="mt-2 ml-2 rounded-full border border-yt-surface px-3 py-1 text-xs font-medium text-yt-text transition-colors hover:bg-yt-surface"
        >
          Change thumbnail
        </button>
      )}
    </>
  );

  const card =
    video.status === "ready" ? (
      <Link
        href={`/watch/${video.id}`}
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-yt-red"
        aria-label={`Watch ${video.title}`}
      >
        {body}
      </Link>
    ) : (
      <div className="block rounded-xl opacity-90" aria-label={`${video.title} (${video.status})`}>
        {body}
      </div>
    );

  return (
    <>
      {card}
      {editing && (
        <ThumbnailEditor
          video={video}
          onClose={() => setEditing(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
