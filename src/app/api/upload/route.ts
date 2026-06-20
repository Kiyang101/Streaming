import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { newId } from "@/lib/ids";
import { uploadPath, vodDir, vodPlaylist, vodThumb, vodThumbRel } from "@/lib/paths";
import { insertVideo, setStatus, setThumbnail, setProgress } from "@/lib/db";
import { transcodeToHls, extractPoster } from "@/lib/transcode";

const ALLOWED = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"];

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const title = (form.get("title") as string) || "Untitled";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.type && !ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `unsupported type: ${file.type}` }, { status: 400 });
  }

  const id = newId();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "mp4";
  const savedPath = uploadPath(`${id}.${ext}`);
  fs.mkdirSync(uploadPath("").replace(/\/$/, ""), { recursive: true });
  fs.writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()));

  insertVideo({
    id,
    title,
    type: "vod",
    status: "processing",
    path: vodPlaylist(id),
    createdAt: Date.now(),
  });

  // Fire-and-forget transcode; status updates when it finishes.
  // Progress is advisory: setProgress failures must never block the "ready" transition.
  transcodeToHls(savedPath, vodDir(id), (p) => setProgress(id, p))
    .then(async () => {
      // Poster extraction is best-effort: failure must never block "ready".
      try {
        await extractPoster(savedPath, vodThumb(id));
        setThumbnail(id, vodThumbRel(id));
      } catch (err) {
        console.error(`poster extraction failed for ${id}:`, err);
      }
      setStatus(id, "ready");
    })
    .catch((err) => {
      console.error(`transcode failed for ${id}:`, err);
      setStatus(id, "failed");
    });

  return NextResponse.json({ id, status: "processing" });
}
