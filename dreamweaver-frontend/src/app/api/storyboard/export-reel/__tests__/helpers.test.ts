import { describe, expect, it } from "bun:test";
import {
  buildConcatArgs,
  buildConcatListFile,
  buildShotNormalizeArgs,
  planShotDownloads,
  REEL_TARGET_FPS,
  REEL_TARGET_HEIGHT,
  REEL_TARGET_WIDTH,
} from "@/app/api/storyboard/export-reel/helpers";

describe("buildShotNormalizeArgs", () => {
  const baseOut = "/tmp/work/shot_0.mp4";

  it("video + audio: maps video from input 0, audio from input 1", () => {
    const { args, kind } = buildShotNormalizeArgs({
      videoPath: "/tmp/work/shot_0.src.mp4",
      imagePath: null,
      audioPath: "/tmp/work/shot_0.src.mp3",
      durationS: 5,
      outputPath: baseOut,
    });
    expect(kind).toBe("video_audio");
    // Order-sensitive: two `-i` flags followed by the mapping args.
    const videoInputIdx = args.indexOf("-i");
    expect(args[videoInputIdx + 1]).toBe("/tmp/work/shot_0.src.mp4");
    const audioInputIdx = args.indexOf("-i", videoInputIdx + 1);
    expect(args[audioInputIdx + 1]).toBe("/tmp/work/shot_0.src.mp3");
    expect(args).toContain("0:v:0");
    expect(args).toContain("1:a:0");
    expect(args).toContain("-shortest");
    expect(args[args.length - 1]).toBe(baseOut);
  });

  it("video only: keeps baked-in audio, no external mix", () => {
    const { args, kind } = buildShotNormalizeArgs({
      videoPath: "/tmp/v.mp4",
      imagePath: null,
      audioPath: null,
      durationS: 4,
      outputPath: baseOut,
    });
    expect(kind).toBe("video_only");
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("0:v:0");
    expect(args).not.toContain("-shortest");
  });

  it("image only with narration: loops still + overlays audio", () => {
    const { args, kind } = buildShotNormalizeArgs({
      videoPath: null,
      imagePath: "/tmp/img.png",
      audioPath: "/tmp/a.mp3",
      durationS: 6,
      outputPath: baseOut,
    });
    expect(kind).toBe("image");
    expect(args).toContain("-loop");
    expect(args).toContain("1");
    const inputs = args.reduce((acc, a, i) => {
      if (a === "-i") acc.push(args[i + 1]);
      return acc;
    }, [] as string[]);
    expect(inputs).toEqual(["/tmp/img.png", "/tmp/a.mp3"]);
    expect(args).toContain("0:v");
    expect(args).toContain("1:a");
  });

  it("image only without narration: synthesizes silence", () => {
    const { args, kind } = buildShotNormalizeArgs({
      videoPath: null,
      imagePath: "/tmp/img.png",
      audioPath: null,
      durationS: 3,
      outputPath: baseOut,
    });
    expect(kind).toBe("image");
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    // Third input (the silence) is at position 2.
    expect(args).toContain("2:a");
  });

  it("neither video nor image: synthesizes black+silent clip", () => {
    const { args, kind } = buildShotNormalizeArgs({
      videoPath: null,
      imagePath: null,
      audioPath: null,
      durationS: 2.5,
      outputPath: baseOut,
    });
    expect(kind).toBe("silent_black");
    const expectedColor = `color=black:s=${REEL_TARGET_WIDTH}x${REEL_TARGET_HEIGHT}:r=${REEL_TARGET_FPS}`;
    expect(args).toContain(expectedColor);
    expect(args).toContain("anullsrc=r=48000:cl=stereo");
    // Duration on the output side of a lavfi synthesis.
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe("2.5");
  });

  it("clamps 0/negative durations to 0.1s so ffmpeg doesn't reject", () => {
    const { args } = buildShotNormalizeArgs({
      videoPath: "/tmp/v.mp4",
      imagePath: null,
      audioPath: null,
      durationS: 0,
      outputPath: baseOut,
    });
    const tIdx = args.indexOf("-t");
    expect(args[tIdx + 1]).toBe("0.1");
  });

  it("every variant targets the reel's uniform resolution + fps", () => {
    const inputs = [
      { videoPath: "/v", imagePath: null, audioPath: null, durationS: 1, outputPath: baseOut },
      { videoPath: "/v", imagePath: null, audioPath: "/a", durationS: 1, outputPath: baseOut },
      { videoPath: null, imagePath: "/i", audioPath: null, durationS: 1, outputPath: baseOut },
      { videoPath: null, imagePath: "/i", audioPath: "/a", durationS: 1, outputPath: baseOut },
    ];
    for (const input of inputs) {
      const { args } = buildShotNormalizeArgs(input);
      const rIdx = args.indexOf("-r");
      expect(args[rIdx + 1]).toBe(String(REEL_TARGET_FPS));
      // scale target appears in the filter string
      expect(args.some((a) => a.includes(`scale=${REEL_TARGET_WIDTH}:${REEL_TARGET_HEIGHT}`))).toBe(true);
    }
  });
});

describe("buildConcatArgs", () => {
  it("uses `-c copy` so the concat stage never re-encodes", () => {
    const args = buildConcatArgs("/tmp/list.txt", "/tmp/reel.mp4");
    expect(args).toContain("-f");
    expect(args).toContain("concat");
    expect(args).toContain("-safe");
    expect(args).toContain("0");
    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args).toContain("-movflags");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/reel.mp4");
  });
});

describe("buildConcatListFile", () => {
  it("wraps every path in `file '...'`", () => {
    const text = buildConcatListFile([
      "/tmp/a/shot_0.mp4",
      "/tmp/a/shot_1.mp4",
    ]);
    expect(text).toBe(
      "file '/tmp/a/shot_0.mp4'\nfile '/tmp/a/shot_1.mp4'\n",
    );
  });

  it("escapes single quotes inside paths to survive ffmpeg quoting", () => {
    const text = buildConcatListFile(["/tmp/ed's/shot_0.mp4"]);
    // ffmpeg's concat demuxer needs `'\''` to escape a single quote.
    expect(text).toBe("file '/tmp/ed'\\''s/shot_0.mp4'\n");
  });
});

describe("planShotDownloads", () => {
  const mkShot = (
    overrides: Partial<{
      videoUrl: string | null;
      imageUrl: string | null;
      audioUrl: string | null;
    }>,
  ) => ({
    nodeId: "n",
    index: 0,
    number: null as string | null,
    label: "Shot",
    durationS: 5,
    videoUrl: null as string | null,
    imageUrl: null as string | null,
    audioUrl: null as string | null,
    prompt: null as string | null,
    ...overrides,
  });

  it("video+audio plan downloads both and skips image", () => {
    const plans = planShotDownloads([
      mkShot({ videoUrl: "v", audioUrl: "a" }),
    ]);
    expect(plans[0].kind).toBe("video_audio");
    expect(plans[0].willDownloadVideo).toBe(true);
    expect(plans[0].willDownloadAudio).toBe(true);
    expect(plans[0].willDownloadImage).toBe(false);
  });

  it("video-only plan skips image + audio", () => {
    const plans = planShotDownloads([mkShot({ videoUrl: "v" })]);
    expect(plans[0].kind).toBe("video_only");
    expect(plans[0].willDownloadImage).toBe(false);
    expect(plans[0].willDownloadAudio).toBe(false);
  });

  it("image+audio plan downloads image + audio", () => {
    const plans = planShotDownloads([
      mkShot({ imageUrl: "i", audioUrl: "a" }),
    ]);
    expect(plans[0].kind).toBe("image");
    expect(plans[0].willDownloadImage).toBe(true);
    expect(plans[0].willDownloadAudio).toBe(true);
    expect(plans[0].willDownloadVideo).toBe(false);
  });

  it("image-only plan downloads image only", () => {
    const plans = planShotDownloads([mkShot({ imageUrl: "i" })]);
    expect(plans[0].kind).toBe("image");
    expect(plans[0].willDownloadImage).toBe(true);
    expect(plans[0].willDownloadAudio).toBe(false);
  });

  it("empty shot becomes silent_black with no downloads", () => {
    const plans = planShotDownloads([mkShot({})]);
    expect(plans[0].kind).toBe("silent_black");
    expect(plans[0].willDownloadVideo).toBe(false);
    expect(plans[0].willDownloadImage).toBe(false);
    expect(plans[0].willDownloadAudio).toBe(false);
  });

  it("preserves the shots' original order + indexes", () => {
    const plans = planShotDownloads([
      mkShot({ videoUrl: "v" }),
      mkShot({ imageUrl: "i" }),
      mkShot({}),
    ]);
    expect(plans.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(plans.map((p) => p.kind)).toEqual([
      "video_only",
      "image",
      "silent_black",
    ]);
  });
});
