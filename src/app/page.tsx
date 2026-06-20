"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Video } from "@/lib/types";
import VideoCard from "@/components/VideoCard";
import UploadModal from "@/components/UploadModal";

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [busy, setBusy] = useState(false);
  // Upload progress as a percentage (0–100), or null when no upload is in flight.
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  async function refresh() {
    const res = await fetch("/api/videos");
    const data = await res.json();
    setVideos(data.videos);
  }

  // Poll faster while anything is still transcoding so the percentage visibly
  // advances, then back off to avoid over-polling an idle library.
  const hasProcessing = videos.some((v) => v.status === "processing");
  useEffect(() => {
    refresh();
    const intervalMs = hasProcessing ? 2000 : 4000; // reflect processing → ready
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [hasProcessing]);

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setProgress(0);

    // XMLHttpRequest (not fetch) so we can report real upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    const finish = () => {
      form.reset();
      setBusy(false);
      setProgress(null);
      setUploadOpen(false);
      refresh();
    };
    xhr.onload = finish;
    xhr.onerror = finish;
    xhr.send(new FormData(form));
  }

  return (
    <div className="mx-auto max-w-screen-xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-yt-text">Library</h1>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="rounded-full bg-yt-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yt-redHover"
        >
          Upload video
        </button>
      </div>

      <p className="mb-6 text-sm text-yt-subtext">
        Live: point OBS at <code>rtmp://localhost:1935/live/devkey</code>, then open{" "}
        <Link href="/live/devkey" className="text-yt-text underline hover:text-yt-red">
          the live page
        </Link>
        .
      </p>

      {videos.length === 0 ? (
        <p className="text-yt-subtext">No videos yet. Upload one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSubmit={onUpload}
        busy={busy}
        progress={progress}
      />
    </div>
  );
}
