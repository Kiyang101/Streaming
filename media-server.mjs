// Standalone process: accepts RTMP from OBS and writes HLS into media/live/<key>/.
// Run with: npm run media-server
import NodeMediaServer from "node-media-server";
import path from "node:path";

const RTMP_PORT = Number(process.env.RTMP_PORT || 1935);
const ALLOWED_KEY = process.env.LIVE_STREAM_KEY || "devkey";
const MEDIA_ROOT = path.join(process.cwd(), "media");

const nms = new NodeMediaServer({
  rtmp: { port: RTMP_PORT, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
  http: { port: 8000, mediaroot: MEDIA_ROOT, allow_origin: "*" },
  trans: {
    ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
    tasks: [
      {
        app: "live",
        hls: true,
        hlsFlags: "[hls_time=2:hls_list_size=4:hls_flags=delete_segments]",
      },
    ],
  },
});

// Reject publishes whose stream key isn't the allowed one.
nms.on("prePublish", (id, streamPath) => {
  const key = streamPath.split("/").pop();
  if (key !== ALLOWED_KEY) {
    const session = nms.getSession(id);
    console.warn(`rejecting publish with bad key: ${key}`);
    session.reject();
  } else {
    console.log(`live stream started: ${streamPath}`);
  }
});

nms.on("donePublish", (_id, streamPath) => console.log(`live stream ended: ${streamPath}`));

nms.run();
console.log(`RTMP ingest on rtmp://localhost:${RTMP_PORT}/live/<key>; HLS under media/live/<key>/`);
