# Video Streaming Platform — Design

**Date:** 2026-06-19
**Status:** Approved, ready for implementation planning

## Goal

A learning-oriented prototype web app that streams video in two modes:

- **VOD (video on demand):** upload a file, transcode it, watch it anytime.
- **Live:** broadcast in real time from OBS, watch in the browser.

It runs entirely on a local machine with free/open-source tools — no cloud
bills — while teaching the real concepts of internet video: RTMP ingest, HLS
packaging, adaptive bitrate, and browser playback.

## Scope

- **In scope:** VOD upload + transcode + playback; live broadcast + playback;
  a browseable library; basic error handling; tests for the VOD path.
- **Out of scope (deferred):** cloud storage/CDN, auto-scaling, authentication
  beyond a live stream key, DRM, recording a live stream into VOD, transcoding
  live into multiple renditions. These are noted as future paths, not built now.

## Foundation Choices

Standardize on two industry-standard technologies that all components share:

- **HLS (HTTP Live Streaming)** as the delivery format — plays on every browser
  and phone, supports adaptive bitrate. A stream/video is an `.m3u8` playlist
  plus `.ts` segment files.
- **FFmpeg** as the transcoding engine.

The payoff: the browser player component is identical for VOD and live — it just
receives a different `.m3u8` URL.

## Architecture

Four cooperating units that communicate through **HLS files on local disk**.

```
Next.js app (UI + API routes)
   ├── VOD path  → FFmpeg worker  → /media/vod/<id>/   (.m3u8 + .ts)
   └── live path → Node-Media-Server → /media/live/<key>/ (.m3u8 + .ts)
                          ▲
                          └── RTMP feed from OBS
```

1. **Next.js web app** — player UI (browse, watch VOD, watch live) plus thin API
   routes (upload, list library, live status). Depends on disk + media-server
   status. Does not know *how* transcoding works, only where output lives.
2. **FFmpeg VOD worker** — given an uploaded file path, produces an HLS
   adaptive-bitrate ladder on disk. Pure input→output, independently testable.
3. **Node-Media-Server** — separate process; accepts the live RTMP feed from OBS
   and writes live HLS to disk. Self-contained.
4. **Local disk (`/media`)** — the shared contract. Producers write HLS; the web
   app serves it. Swappable later for S3 with no API changes.

**Key design idea:** everyone communicates through HLS files on disk. This
decoupling keeps each piece understandable and replaceable on its own.

## Data Flow

### VOD flow
1. User uploads `myvideo.mp4` via the UI → API route saves to `/media/uploads/`.
2. API starts the FFmpeg VOD worker → produces an HLS ladder (e.g. 1080p/720p/
   480p) in `/media/vod/<id>/` with a master `.m3u8` + `.ts` segments.
3. Status is `processing` during transcode; flips to `ready` on clean exit,
   `failed` on error.
4. User opens the video page → hls.js loads `/media/vod/<id>/master.m3u8` →
   plays, auto-switching renditions by bandwidth.

### Live flow
1. User points OBS at `rtmp://localhost:1935/live/<stream-key>` and starts.
2. Node-Media-Server receives RTMP, continuously writes HLS to
   `/media/live/<stream-key>/`.
3. UI polls a live-status API route (or checks playlist existence) and shows the
   stream as live.
4. Viewers open the live page → hls.js plays `/media/live/<stream-key>/index.m3u8`,
   refreshing the rolling playlist to stay near the live edge (a few seconds of
   latency — normal for HLS).
5. On broadcaster stop, the stream is marked offline.

### State
A lightweight **SQLite** database (via `better-sqlite3`) holds the library:
`id`, `title`, `status`, `type` (vod/live), `path`, timestamps.

## Concrete Stack (all free / open-source)

| Concern          | Choice                                  |
|------------------|-----------------------------------------|
| App framework    | Next.js (App Router)                    |
| Language         | TypeScript                              |
| Live ingest      | node-media-server                       |
| Transcoding      | FFmpeg (spawned, or via fluent-ffmpeg)  |
| Browser player   | hls.js                                  |
| Metadata store   | SQLite (better-sqlite3)                 |
| Broadcaster      | OBS Studio                              |
| Styling          | Tailwind CSS                            |

## Error Handling

- **FFmpeg failure** → catch non-zero exit, mark video `failed`, surface error in
  UI instead of leaving it stuck on `processing`.
- **Upload validation** → check file type/size before transcoding; reject junk early.
- **Live stream drop** → Node-Media-Server disconnect event → mark stream offline.
- **Player load failure** → hls.js error events → show "stream unavailable / still
  processing" instead of a frozen black box.
- **Stream-key check** → reject RTMP publishes with an unknown key.

## Testing

- **Unit:** VOD worker (feed a tiny sample clip, assert valid `.m3u8` + segments);
  metadata store (CRUD on the library).
- **Integration:** upload → transcode → `ready` happy path via the API.
- **Manual smoke test:** live path (OBS → watch in browser), documented as a
  checklist — automating a real RTMP broadcast is overkill for a prototype.
- A small **sample video** committed to the repo so tests don't depend on a
  user-supplied file.

## Future Paths (not in this build)

- Managed cloud (Mux / Cloudflare Stream) for production-scale ingest/transcode/CDN.
- Cloud storage (S3) behind the same `/media` contract.
- Recording live broadcasts into replayable VOD.
- Real user authentication and access control.
