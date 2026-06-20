"use client";
import { useState } from "react";
import Player from "@/components/Player";
import ThumbnailEditor from "@/components/ThumbnailEditor";
import type { Video } from "@/lib/types";

/** Watch-page player wrapper: tracks current playback time and hosts the
 *  thumbnail editor so the frame tab can default to the current position. */
export default function WatchPlayer({ video }: { video: Video }) {
  const [editing, setEditing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  return (
    <>
      <Player src={`/media/${video.path}`} onTimeUpdate={setCurrentTime} />
      {video.type === "vod" && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 rounded-full border border-yt-surface px-3 py-1 text-sm font-medium text-yt-text transition-colors hover:bg-yt-surface"
        >
          Edit thumbnail
        </button>
      )}
      {editing && (
        <ThumbnailEditor
          video={video}
          defaultTimestamp={currentTime}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
