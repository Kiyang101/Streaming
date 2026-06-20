"use client";

import { useEffect } from "react";

/**
 * Styled upload dialog for VOD uploads.
 *
 * This component is presentation-only. The upload lifecycle (the XHR call, the
 * real upload-progress events, busy state, and the post-upload refresh) lives
 * in the parent (src/app/page.tsx) and is passed in unchanged via props. The
 * modal must NOT reimplement or alter that logic — it only restyles the form,
 * the submit button, and the progress bar.
 */
export interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  /** Upload submit handler owned by the parent (preserves the exact XHR flow). */
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  /** True while an upload is in flight. */
  busy: boolean;
  /** Upload progress 0–100, or null when no upload is in flight. */
  progress: number | null;
}

export default function UploadModal({
  open,
  onClose,
  onSubmit,
  busy,
  progress,
}: UploadModalProps) {
  // Close on Escape, but never while an upload is mid-flight (avoids orphaning
  // the in-progress XHR / leaving the user unsure whether it completed).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload a video"
    >
      {/* Backdrop. Clicking it closes the modal, unless an upload is running. */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => {
          if (!busy) onClose();
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl bg-yt-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-yt-text">Upload a video</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-full px-2 text-xl leading-none text-yt-subtext hover:text-yt-text disabled:opacity-40"
          >
            &times;
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm text-yt-subtext" htmlFor="upload-title">
              Title
            </label>
            <input
              id="upload-title"
              name="title"
              placeholder="My video"
              className="w-full rounded-lg bg-yt-bg p-2 text-yt-text placeholder:text-yt-subtext outline-none focus:ring-2 focus:ring-yt-red"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-yt-subtext" htmlFor="upload-file">
              Video file
            </label>
            <input
              id="upload-file"
              name="file"
              type="file"
              accept="video/*"
              required
              disabled={busy}
              className="block w-full text-sm text-yt-subtext file:mr-3 file:rounded-lg file:border-0 file:bg-yt-red file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-yt-redHover disabled:opacity-50"
            />
          </div>

          <button
            disabled={busy}
            className="w-full rounded-lg bg-yt-red px-4 py-2 font-medium text-white transition-colors hover:bg-yt-redHover disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload"}
          </button>

          {progress !== null && (
            <div className="space-y-1" aria-label="Upload progress">
              <div className="h-2 w-full overflow-hidden rounded bg-yt-bg">
                <div
                  className="h-full bg-yt-red transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-yt-subtext">
                {progress < 100
                  ? `Uploading… ${progress}%`
                  : "Upload complete — processing…"}
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
