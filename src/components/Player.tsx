"use client";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

/** Plays an HLS source (.m3u8). Works for both VOD and live. `src` is a relative
 *  media URL like "/media/vod/<id>/master.m3u8". */
export default function Player({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);

    // Safari plays HLS natively.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError("Stream unavailable or still processing.");
      });
      return () => hls.destroy();
    }
    setError("HLS is not supported in this browser.");
  }, [src]);

  if (error) {
    return <div className="aspect-video grid place-items-center bg-neutral-900 text-neutral-400">{error}</div>;
  }
  return <video ref={videoRef} controls className="w-full aspect-video bg-black" />;
}
