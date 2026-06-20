"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Hls from "hls.js";
import { selectHlsStrategy } from "@/lib/hlsStrategy";

/** Quality level as surfaced in the settings menu. `id` maps to an hls.js level
 *  index (the position in `hls.levels`); `id === AUTO_LEVEL` means adaptive. */
type QualityOption = { id: number; label: string };

/** hls.js uses -1 to mean automatic (adaptive bitrate) level selection. */
const AUTO_LEVEL = -1;
/** Idle time (ms) before the control overlay autohides during playback. */
const CONTROLS_IDLE_MS = 2500;
/** Seconds to jump when seeking with the left/right arrow keys. */
const SEEK_STEP_SECONDS = 5;

/** Format a number of seconds as m:ss (or h:mm:ss for long content). Guards
 *  against NaN/Infinity, which `video.duration` reports before metadata loads. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins);
  const ss = String(secs).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Plays an HLS source (.m3u8) with a custom YouTube-style control overlay.
 *  Works for both VOD and live. `src` is a relative media URL like
 *  "/media/vod/<id>/master.m3u8". */
export default function Player({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [levels, setLevels] = useState<QualityOption[]>([]);
  const [currentLevel, setCurrentLevel] = useState(AUTO_LEVEL);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // --- Source attachment ---------------------------------------------------
  // CRITICAL: hls.js-first selection preserved exactly. selectHlsStrategy is
  // called with (Hls.isSupported(), canPlayType('application/vnd.apple.mpegurl'))
  // in this order; hls.js wins whenever supported. Do not revert to native-first
  // (regression fix 401c9e5 — protects webview/MSE playback, e.g. VS Code).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setLevels([]);
    setCurrentLevel(AUTO_LEVEL);

    const strategy = selectHlsStrategy(
      Hls.isSupported(),
      video.canPlayType("application/vnd.apple.mpegurl"),
    );

    if (strategy === "hlsjs") {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      // Populate the quality menu once hls.js has parsed the manifest. Levels are
      // ordered low->high; label by height when known, otherwise by bitrate.
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const options: QualityOption[] = hls.levels.map((level, index) => ({
          id: index,
          label: level.height
            ? `${level.height}p`
            : `${Math.round(level.bitrate / 1000)} kbps`,
        }));
        setLevels(options);
        setCurrentLevel(hls.currentLevel);
      });
      // Keep the menu's checkmark in sync with adaptive (auto) level switches.
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(hls.autoLevelEnabled ? AUTO_LEVEL : data.level);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setError("Stream unavailable or still processing.");
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (strategy === "native") {
      video.src = src;
      return;
    }
    setError("HLS is not supported in this browser.");
  }, [src]);

  // --- Control helpers -----------------------------------------------------
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      // play() rejects if autoplay is blocked or the element is detached; the
      // catch keeps the UI consistent rather than throwing an unhandled rejection.
      void video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const next = Math.min(
      Math.max(video.currentTime + deltaSeconds, 0),
      video.duration,
    );
    video.currentTime = next;
  }, []);

  const seekTo = useCallback((fraction: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const clamped = Math.min(Math.max(fraction, 0), 1);
    video.currentTime = clamped * video.duration;
  }, []);

  const handleVolumeChange = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.min(Math.max(value, 0), 1);
    video.volume = clamped;
    // Adjusting the slider above zero implicitly unmutes; dragging to zero mutes.
    video.muted = clamped === 0;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void container.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked by permissions policy; failing silently keeps
      // the rest of the controls usable.
    }
  }, []);

  const selectQuality = useCallback((levelId: number) => {
    const hls = hlsRef.current;
    if (hls) {
      // hls.currentLevel = -1 re-enables adaptive selection.
      hls.currentLevel = levelId;
    }
    setCurrentLevel(levelId);
    setShowSettings(false);
  }, []);

  // --- Autohide controls ---------------------------------------------------
  const revealControls = useCallback(() => {
    setShowControls(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    // Only autohide while actually playing; a paused/settings-open player keeps
    // its controls so the user can act on them.
    idleTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowSettings(false);
      }
    }, CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // --- Media element event wiring -----------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true); // never hide controls while paused
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () =>
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted || video.volume === 0);
    };
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onError = () => setError("Video playback failed. Please try again.");

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("progress", onProgress);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("durationchange", onDurationChange);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("error", onError);
    };
  }, []);

  // --- Fullscreen state sync ----------------------------------------------
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // --- Keyboard shortcuts --------------------------------------------------
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Ignore shortcuts while interacting with the volume slider so arrow keys
      // adjust volume natively instead of seeking the video.
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT") return;

      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "m":
          event.preventDefault();
          toggleMute();
          break;
        case "f":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "ArrowRight":
          event.preventDefault();
          seekBy(SEEK_STEP_SECONDS);
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekBy(-SEEK_STEP_SECONDS);
          break;
        default:
          return;
      }
      revealControls();
    },
    [togglePlay, toggleMute, toggleFullscreen, seekBy, revealControls],
  );

  // --- Scrub bar interaction ----------------------------------------------
  const handleScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const bar = event.currentTarget;
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return;
      const fraction = (event.clientX - rect.left) / rect.width;
      seekTo(fraction);
    },
    [seekTo],
  );

  // --- Error state ---------------------------------------------------------
  if (error) {
    return (
      <div className="aspect-video w-full grid place-items-center bg-yt-surface px-6 text-center">
        <div>
          <p className="text-yt-text font-medium">{error}</p>
          <p className="mt-1 text-sm text-yt-subtext">
            The video could not be played in this browser.
          </p>
        </div>
      </div>
    );
  }

  const progressFraction = duration > 0 ? currentTime / duration : 0;
  const bufferedFraction = duration > 0 ? Math.min(buffered / duration, 1) : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-yt-bg overflow-hidden outline-none group/player"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={revealControls}
      onMouseLeave={() => {
        if (videoRef.current && !videoRef.current.paused) {
          setShowControls(false);
          setShowSettings(false);
        }
      }}
    >
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        playsInline
        onClick={togglePlay}
      />

      {/* Center play/pause button — large affordance, only the play glyph shows
          prominently while paused. */}
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
        className={`absolute inset-0 m-auto h-16 w-16 grid place-items-center rounded-full bg-black/50 text-yt-text transition-opacity ${
          isPlaying ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
      >
        {isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
      </button>

      {/* Control overlay (scrub bar + bottom bar). Fades with idle state. */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrub / progress bar with buffered indicator. */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(currentTime)}
          className="relative h-1.5 w-full cursor-pointer rounded-full bg-white/30"
          onPointerDown={handleScrub}
        >
          {/* Buffered range */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/50"
            style={{ width: `${bufferedFraction * 100}%` }}
          />
          {/* Played range */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-yt-red"
            style={{ width: `${progressFraction * 100}%` }}
          />
          {/* Scrubber handle */}
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yt-red"
            style={{ left: `${progressFraction * 100}%` }}
          />
        </div>

        {/* Bottom control bar */}
        <div className="mt-1 flex items-center gap-3 text-yt-text">
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={togglePlay}
            className="grid place-items-center hover:text-yt-red"
          >
            {isPlaying ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
          </button>

          {/* Volume: mute toggle + slider */}
          <div className="flex items-center gap-2 group/volume">
            <button
              type="button"
              aria-label={isMuted ? "Unmute" : "Mute"}
              onClick={toggleMute}
              className="grid place-items-center hover:text-yt-red"
            >
              {isMuted || volume === 0 ? (
                <MuteIcon className="h-5 w-5" />
              ) : (
                <VolumeIcon className="h-5 w-5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              aria-label="Volume"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="h-1 w-0 cursor-pointer accent-yt-red transition-all duration-200 group-hover/volume:w-20 focus:w-20"
            />
          </div>

          {/* Time display */}
          <span className="text-sm tabular-nums text-yt-text">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Settings / quality menu */}
          {levels.length > 0 && (
            <div className="relative">
              <button
                type="button"
                aria-label="Quality settings"
                aria-haspopup="menu"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((open) => !open)}
                className="grid place-items-center hover:text-yt-red"
              >
                <SettingsIcon className="h-5 w-5" />
              </button>
              {showSettings && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 mb-2 min-w-32 overflow-hidden rounded-md bg-yt-surface py-1 text-sm shadow-lg"
                >
                  <QualityItem
                    label="Auto"
                    selected={currentLevel === AUTO_LEVEL}
                    onClick={() => selectQuality(AUTO_LEVEL)}
                  />
                  {levels.map((level) => (
                    <QualityItem
                      key={level.id}
                      label={level.label}
                      selected={currentLevel === level.id}
                      onClick={() => selectQuality(level.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fullscreen toggle */}
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={toggleFullscreen}
            className="grid place-items-center hover:text-yt-red"
          >
            {isFullscreen ? (
              <ExitFullscreenIcon className="h-5 w-5" />
            ) : (
              <FullscreenIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A single row in the quality menu. */
function QualityItem({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-white/10 ${
        selected ? "text-yt-red" : "text-yt-text"
      }`}
    >
      <span>{label}</span>
      {selected && <CheckIcon className="h-4 w-4" />}
    </button>
  );
}

// --- Inline SVG icons (no external icon dependency) ------------------------
type IconProps = { className?: string };

function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function VolumeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12zM14 3.23v2.06a7 7 0 010 13.42v2.06a9 9 0 000-17.54z" />
    </svg>
  );
}

function MuteIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3zm18.5-1.5L20 7l-2.5 2.5L15 7l-1.5 1.5L16 11l-2.5 2.5L15 15l2.5-2.5L20 15l1.5-1.5L19 11z" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.14 12.94a7.49 7.49 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.3 7.3 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54a7.3 7.3 0 00-1.62.94l-2.39-.96a.5.5 0 00-.61.22L2.7 8.84a.5.5 0 00.12.64l2.03 1.58a7.49 7.49 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32a.5.5 0 00.61.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54a.5.5 0 00.5.42h3.84a.5.5 0 00.5-.42l.36-2.54c.58-.24 1.12-.56 1.62-.94l2.39.96a.5.5 0 00.61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z" />
    </svg>
  );
}

function FullscreenIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

function ExitFullscreenIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}
