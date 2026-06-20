import { NextRequest, NextResponse } from "next/server";
import { getVideo, setUpscaleStatus, setUpscaleProgress } from "@/lib/db";
import { findUpload, vodDir } from "@/lib/paths";
import { checkUpscaleEligibility } from "@/lib/upscaleEligibility";
import { tryAcquire, release, activeUpscale } from "@/lib/upscaleLock";
import { upscaleVideoToHls } from "@/lib/upscale";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);

  const elig = checkUpscaleEligibility(video, activeUpscale() !== null);
  if (!elig.ok) return NextResponse.json({ error: elig.error }, { status: elig.status });

  // Eligible — claim the single-job lock (guards against a race between checks).
  if (!tryAcquire(id)) {
    return NextResponse.json({ error: "another upscale is running" }, { status: 409 });
  }

  const source = findUpload(id);
  if (!source) {
    release(id);
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  setUpscaleStatus(id, "upscaling");
  setUpscaleProgress(id, 0);

  // Fire-and-forget, mirroring the upload route. Progress is advisory.
  upscaleVideoToHls(source, vodDir(id), (p) => setUpscaleProgress(id, p))
    .then(() => setUpscaleStatus(id, "upscaled"))
    .catch((err) => {
      console.error(`upscale failed for ${id}:`, err);
      setUpscaleStatus(id, "failed");
    })
    .finally(() => release(id));

  return NextResponse.json({ id, upscaleStatus: "upscaling" });
}
