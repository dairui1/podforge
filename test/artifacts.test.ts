import { describe, expect, test } from "vitest";

import { formatTimestamp, renderSrt, renderTxt } from "../src/output/transcript";
import type { TranscriptSegment } from "../src/transcribe/types";

const segments: TranscriptSegment[] = [
  {
    startMs: 0,
    endMs: 1725,
    text: "Hello world.",
  },
  {
    startMs: 2500,
    endMs: 5450,
    text: "This is a test transcript.",
  },
];

describe("transcript artifact renderers", () => {
  test("formats timestamps as SRT-compatible clock strings", () => {
    expect(formatTimestamp(0)).toBe("00:00:00,000");
    expect(formatTimestamp(1725)).toBe("00:00:01,725");
    expect(formatTimestamp(3723001)).toBe("01:02:03,001");
  });

  test("renders SRT output", () => {
    expect(renderSrt(segments)).toBe(`1
00:00:00,000 --> 00:00:01,725
Hello world.

2
00:00:02,500 --> 00:00:05,450
This is a test transcript.
`);
  });

  test("renders plain text output", () => {
    expect(renderTxt(segments)).toBe(`Hello world.
This is a test transcript.
`);
  });
});
