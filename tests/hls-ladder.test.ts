import { describe, it, expect } from "vitest";
import { buildHlsArgs, DEFAULT_LADDER, UHD_LADDER } from "@/lib/transcode";
import path from "node:path";

describe("buildHlsArgs", () => {
  it("reproduces the original 720p/480p args for the default ladder", () => {
    const out = "/tmp/out";
    expect(buildHlsArgs("in.mp4", out, DEFAULT_LADDER)).toEqual([
      "-y",
      "-i", "in.mp4",
      "-filter_complex", "[0:v]split=2[v0][v1];[v0]scale=w=1280:h=720[v0out];[v1]scale=w=854:h=480[v1out]",
      "-map", "[v0out]", "-c:v:0", "libx264", "-b:v:0", "2800k",
      "-map", "[v1out]", "-c:v:1", "libx264", "-b:v:1", "1400k",
      "-map", "a:0?", "-map", "a:0?", "-c:a", "aac", "-b:a", "128k",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_playlist_type", "vod",
      "-hls_segment_filename", path.join(out, "v%v_%03d.ts"),
      "-master_pl_name", "master.m3u8",
      "-var_stream_map", "v:0,a:0 v:1,a:1",
      path.join(out, "v%v.m3u8"),
    ]);
  });

  it("builds a 3-rendition var_stream_map and split for the UHD ladder", () => {
    const args = buildHlsArgs("in.mp4", "/tmp/out", UHD_LADDER);
    expect(args).toContain("[0:v]split=3[v0][v1][v2];[v0]scale=w=3840:h=2160[v0out];[v1]scale=w=1920:h=1080[v1out];[v2]scale=w=1280:h=720[v2out]");
    expect(args).toContain("v:0,a:0 v:1,a:1 v:2,a:2");
    expect(args).toContain("-b:v:0");
    expect(args).toContain("16000k");
  });

  it("exposes a UHD ladder topping out at 2160p", () => {
    expect(UHD_LADDER[0]).toEqual({ width: 3840, height: 2160, bitrate: "16000k" });
  });
});
