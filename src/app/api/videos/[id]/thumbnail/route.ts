import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getVideo, setThumbnail } from "@/lib/db";
import { mediaRoot, findUpload, vodThumbVersioned, vodThumbVersionedRel } from "@/lib/paths";
import { extractPosterAt, normalizeImageToJpeg } from "@/lib/transcode";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (video.type !== "vod") {
    return NextResponse.json({ error: "thumbnails are VOD-only" }, { status: 400 });
  }

  const ts = Date.now();
  const outAbs = vodThumbVersioned(id, ts);
  const outRel = vodThumbVersionedRel(id, ts);
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { timestamp?: unknown };
      const timestamp = Number(body.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        return NextResponse.json({ error: "invalid timestamp" }, { status: 400 });
      }
      const source = findUpload(id);
      if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });
      await extractPosterAt(source, outAbs, timestamp);
    } else {
      const form = await req.formData();
      const file = form.get("image");
      if (!(file instanceof File) || !file.type.startsWith("image/")) {
        return NextResponse.json({ error: "expected an image file" }, { status: 415 });
      }
      const tmp = path.join(os.tmpdir(), `thumb-src-${ts}`);
      fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
      try {
        await normalizeImageToJpeg(tmp, outAbs);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
  } catch (err) {
    console.error(`thumbnail update failed for ${id}:`, err);
    return NextResponse.json({ error: "thumbnail processing failed" }, { status: 500 });
  }

  const previous = video.thumbnail;
  setThumbnail(id, outRel);

  // Best-effort cleanup of the prior thumbnail file; never fatal — the new
  // thumbnail is already committed to the DB.
  if (previous && previous !== outRel) {
    try {
      fs.rmSync(path.join(mediaRoot(), previous), { force: true });
    } catch (err) {
      console.error(`old thumbnail cleanup failed for ${id}:`, err);
    }
  }

  return NextResponse.json({ id, thumbnail: outRel });
}
