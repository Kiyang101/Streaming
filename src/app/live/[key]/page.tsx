"use client";
import { use, useEffect, useState } from "react";
import Player from "@/components/Player";
import Link from "next/link";
import { livePlaylist } from "@/lib/paths";

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
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <Link href="/" className="text-blue-400 underline">← Library</Link>
      <h1 className="text-xl font-bold">Live: {key}</h1>
      {live ? (
        <Player src={`/media/${livePlaylist(key)}`} />
      ) : (
        <div className="aspect-video grid place-items-center bg-neutral-900 text-neutral-400">
          Offline — start streaming from OBS to <code>rtmp://localhost:1935/live/{key}</code>.
        </div>
      )}
    </main>
  );
}
