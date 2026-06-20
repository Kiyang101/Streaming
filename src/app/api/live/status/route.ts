import { NextRequest, NextResponse } from "next/server";
import { isLive } from "@/lib/live";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  return NextResponse.json({ key, live: key ? isLive(key) : false });
}
