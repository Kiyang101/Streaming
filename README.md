# Video Streaming Prototype

Local-only demo that plays video in the browser three ways: on-demand
(uploaded → transcoded → HLS), live (OBS → RTMP → HLS), and local files played
straight from your device with no upload.

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

## Local files (no upload)

Open http://localhost:3000/local to play video files straight from your device —
no upload, no transcode. Pick one or more files; they queue up and play through
the same player. In browsers with the File System Access API (e.g. Chrome) the
queue is remembered across reloads (you re-grant read access on return). In
browsers without it (e.g. VS Code's Simple Browser) playback is session-only.

Playback uses the browser's native decoder, so well-supported formats (MP4 /
H.264) are most reliable; some containers/codecs (e.g. MKV) may not play.

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
