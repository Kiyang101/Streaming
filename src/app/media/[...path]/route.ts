import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { mediaRoot } from "@/lib/paths";

export function contentTypeFor(name: string): string {
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".ts")) return "video/mp2t";
  if (name.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  // Prevent path traversal: reject any ".." segment.
  if (parts.some((p) => p === ".." || p.includes("\0"))) {
    return new Response("Bad request", { status: 400 });
  }
  const filePath = path.join(mediaRoot(), ...parts);
  if (!filePath.startsWith(mediaRoot()) || !fs.existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const data = fs.readFileSync(filePath);
  return new Response(data, {
    headers: {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": "no-cache",
    },
  });
}
