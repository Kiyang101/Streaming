"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Video } from "@/lib/types";

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [busy, setBusy] = useState(false);
  // Upload progress as a percentage (0–100), or null when no upload is in flight.
  const [progress, setProgress] = useState<number | null>(null);

  async function refresh() {
    const res = await fetch("/api/videos");
    const data = await res.json();
    setVideos(data.videos);
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000); // reflect processing → ready
    return () => clearInterval(t);
  }, []);

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
      refresh();
    };
    xhr.onload = finish;
    xhr.onerror = finish;
    xhr.send(new FormData(form));
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Streaming Prototype</h1>

      <form onSubmit={onUpload} className="space-y-2 bg-neutral-900 p-4 rounded">
        <h2 className="font-semibold">Upload a video (VOD)</h2>
        <input name="title" placeholder="Title" className="w-full p-2 rounded bg-neutral-800" />
        <input name="file" type="file" accept="video/*" required disabled={busy} className="block" />
        <button disabled={busy} className="px-4 py-2 bg-blue-600 rounded disabled:opacity-50">
          {busy ? "Uploading…" : "Upload"}
        </button>
        {progress !== null && (
          <div className="space-y-1" aria-label="Upload progress">
            <div className="h-2 w-full overflow-hidden rounded bg-neutral-800">
              <div
                className="h-full bg-blue-500 transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-neutral-400">
              {progress < 100 ? `Uploading… ${progress}%` : "Upload complete — processing…"}
            </p>
          </div>
        )}
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">Library</h2>
        <p className="text-sm text-neutral-400">
          Live: point OBS at <code>rtmp://localhost:1935/live/devkey</code>, then open{" "}
          <Link href="/live/devkey" className="text-blue-400 underline">the live page</Link>.
        </p>
        {videos.length === 0 && <p className="text-neutral-500">No videos yet.</p>}
        <ul className="divide-y divide-neutral-800">
          {videos.map((v) => (
            <li key={v.id} className="py-2 flex justify-between">
              <span>{v.title}</span>
              {v.status === "ready" ? (
                <Link href={`/watch/${v.id}`} className="text-blue-400 underline">Watch</Link>
              ) : (
                <span className="text-neutral-500">{v.status}…</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
