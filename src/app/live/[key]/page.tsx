"use client";
import { use, useEffect, useState } from "react";
import Player from "@/components/Player";
import Link from "next/link";

export default function Live({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [live, setLive] = useState(false);

  useEffect(() => {
    async function poll() {
      const res = await fetch(`/api/live/status?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      setLive(data.live);
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [key]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6 text-yt-text">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-yt-subtext transition-colors hover:text-yt-text"
      >
        ← Library
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-yt-text">Live: {key}</h1>
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yt-red px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-yt-text">
            <span className="h-2 w-2 rounded-full bg-yt-text" />
            Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yt-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-yt-subtext">
            <span className="h-2 w-2 rounded-full bg-yt-subtext" />
            Offline
          </span>
        )}
      </div>

      {live ? (
        <div className="overflow-hidden rounded-xl bg-yt-surface">
          <Player src={`/media/live/${key}/index.m3u8`} />
        </div>
      ) : (
        <div className="grid aspect-video place-items-center rounded-xl bg-yt-surface px-6 text-center">
          <div className="space-y-3">
            <p className="text-lg font-semibold text-yt-text">This stream is offline</p>
            <p className="text-sm text-yt-subtext">
              Start streaming from OBS to{" "}
              <code className="rounded bg-yt-bg px-1.5 py-0.5 font-mono text-xs text-yt-text">
                rtmp://localhost:1935/live/{key}
              </code>
            </p>
            <p className="text-xs text-yt-subtext">
              This page checks every few seconds and will switch to the player automatically.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
