import { NextResponse } from "next/server";
import { listVideos } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ videos: listVideos() });
}
