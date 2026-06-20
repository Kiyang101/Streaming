# Video Streaming Prototype

Local-only demo that streams both on-demand (uploaded → transcoded) and live
(OBS → RTMP) video to the browser via HLS.

## Requirements
- Node.js 20+
- FFmpeg on PATH (`ffmpeg -version`)
- OBS Studio (for the live demo)

## Setup
```bash
npm install
cp .env.local.example .env.local
```

## Run
Two processes, in separate terminals:
```bash
npm run dev            # Next.js app at http://localhost:3000
npm run media-server   # RTMP ingest at rtmp://localhost:1935
```

## VOD demo
1. Open http://localhost:3000
2. Upload a video. It shows "processing…" then "Watch" when transcoded.
3. Click Watch — it plays via HLS with adaptive bitrate.

## Live smoke-test checklist (manual)
1. Start both processes above.
2. In OBS → Settings → Stream: Service "Custom", Server
   `rtmp://localhost:1935/live`, Stream Key `devkey`.
3. Click "Start Streaming" in OBS.
4. Open http://localhost:3000/live/devkey — within a few seconds it flips from
   "Offline" to a live player showing your broadcast (a few seconds of latency
   is normal for HLS).
5. Click "Stop Streaming" in OBS — the page returns to "Offline".

## Tests
```bash
npm test
```

## 4K AI upscaling (optional)

Ready VODs show an **Upscale to 4K** button. It runs Real-ESRGAN super-resolution
on the original upload, then rebuilds the HLS ladder with a true 2160p rendition.
This is GPU-bound and slow — expect minutes of processing per minute of video.

Requires the `realesrgan-ncnn-vulkan` binary and its model files. It is **not**
in Homebrew — download the prebuilt portable bundle (binary + `models/`) from the
official Real-ESRGAN release, e.g. for macOS (Apple Silicon and Intel, universal):

    DEST=~/tools/realesrgan
    mkdir -p "$DEST"
    curl -L -o /tmp/realesrgan.zip \
      https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip
    unzip /tmp/realesrgan.zip -d "$DEST"
    chmod +x "$DEST/realesrgan-ncnn-vulkan"
    xattr -dr com.apple.quarantine "$DEST"   # clear Gatekeeper quarantine (unsigned binary)

(The `*-macos.zip` from the `xinntao/Real-ESRGAN-ncnn-vulkan` repo ships the binary
*without* the `models/` folder — use the `xinntao/Real-ESRGAN` release above, which
bundles both. Linux/Windows portable bundles are on the same release page.)

Environment variables:

- `REALESRGAN_PATH` — path to the binary (default `realesrgan-ncnn-vulkan` on `PATH`),
  e.g. `~/tools/realesrgan/realesrgan-ncnn-vulkan`
- `REALESRGAN_MODEL` — model name (default `realesrgan-x4plus`)
- `REALESRGAN_MODELS` — path to the models directory (passed as `-m`); set this to the
  bundle's `models/` dir, e.g. `~/tools/realesrgan/models`, unless it sits next to the binary

Only one upscale job runs at a time. If the binary is missing the job fails and
the card shows a failed state; the original video remains playable.
