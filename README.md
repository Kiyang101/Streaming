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
