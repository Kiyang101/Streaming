import Link from "next/link";
import type { Video, VideoStatus } from "@/lib/types";

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

export default function VideoCard({ video }: { video: Video }) {
  const body = (
    <>
      <Thumbnail video={video} />
      <div className="mt-3 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-medium text-yt-text">
          {video.title}
        </h3>
        <StatusBadge status={video.status} />
      </div>
    </>
  );

  // Only "ready" videos are watchable; everything else is a static card.
  if (video.status === "ready") {
    return (
      <Link
        href={`/watch/${video.id}`}
        className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-yt-red"
        aria-label={`Watch ${video.title}`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="block rounded-xl opacity-90" aria-label={`${video.title} (${video.status})`}>
      {body}
    </div>
  );
}
