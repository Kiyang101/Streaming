import Player from "@/components/Player";
import VideoCard from "@/components/VideoCard";
import { getVideo, listVideos } from "@/lib/db";
import type { Video } from "@/lib/types";
import { notFound } from "next/navigation";
import Link from "next/link";

// Human-readable labels for the video type metadata chip.
const TYPE_LABEL: Record<Video["type"], string> = {
  vod: "Video on demand",
  live: "Live stream",
};

/**
 * Format the millisecond epoch `createdAt` as an absolute date.
 * Falls back to an empty string if the timestamp is missing/invalid so the
 * page never renders "Invalid Date".
 */
function formatCreatedAt(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "";
  return new Date(createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function Watch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) notFound();

  // Reuse the shared video library data (same source as GET /api/videos) for
  // the related list. Calling listVideos() directly avoids an SSR self-fetch
  // and the base-URL problems that come with it. The currently-watched video
  // is excluded so it never appears in its own "related" rail.
  const related = listVideos().filter((v) => v.id !== video.id);
  const createdAt = formatCreatedAt(video.createdAt);

  return (
    <main className="mx-auto max-w-screen-xl p-6">
      <Link
        href="/"
        className="mb-4 inline-block text-sm text-yt-subtext underline transition-colors hover:text-yt-red"
      >
        ← Library
      </Link>

      <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-3">
        {/* Main column: player + title + metadata */}
        <div className="lg:col-span-2">
          <Player src={`/media/${video.path}`} />

          <h1 className="mt-4 text-xl font-bold text-yt-text">{video.title}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-yt-subtext">
            <span className="rounded-full bg-yt-surface px-2 py-0.5 text-xs font-medium">
              {TYPE_LABEL[video.type] ?? video.type}
            </span>
            {createdAt && <span>{createdAt}</span>}
          </div>
        </div>

        {/* Right column: related / other videos */}
        <aside className="lg:col-span-1" aria-label="Related videos">
          <h2 className="mb-4 text-sm font-semibold text-yt-text">Up next</h2>
          {related.length === 0 ? (
            <p className="text-sm text-yt-subtext">No other videos yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {related.map((v) => (
                <VideoCard key={v.id} video={v} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
