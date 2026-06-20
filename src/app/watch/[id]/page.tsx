import Player from "@/components/Player";
import { getVideo } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function Watch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = getVideo(id);
  if (!video) notFound();

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <Link href="/" className="text-blue-400 underline">← Library</Link>
      <h1 className="text-xl font-bold">{video.title}</h1>
      <Player src={`/media/${video.path}`} />
    </main>
  );
}
