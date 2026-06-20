"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { selectHlsStrategy } from "@/lib/hlsStrategy";

/** Plays an HLS source (.m3u8). Works for both VOD and live. `src` is a relative
 *  media URL like "/media/vod/<id>/master.m3u8". */
export default function Player({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    // Prefer hls.js wherever it runs; only fall back to native HLS when it can't
    // (e.g. iOS Safari). Native-first breaks browsers that report "maybe" for HLS
    // but can't actually decode it (e.g. VS Code's embedded browser) — black video.
    const strategy = selectHlsStrategy(
      Hls.isSupported(),
      video.canPlayType("application/vnd.apple.mpegurl"),
    );

    if (strategy === "hlsjs") {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError("Stream unavailable or still processing.");
      });
      return () => hls.destroy();
    }
    if (strategy === "native") {
      video.src = src;
      return;
    }
    setError("HLS is not supported in this browser.");
  }, [src]);

  if (error) {
    return <div className="aspect-video grid place-items-center bg-neutral-900 text-neutral-400">{error}</div>;
  }
  return <video ref={videoRef} controls className="w-full aspect-video bg-black" />;
}
