import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultSourceAdapters } from "../src/sources";
import { createElevenLabsProvider } from "../src/transcribe/elevenlabs";
import { transcribeInput } from "../src/transcribe/workflow";

const apiKey = process.env.ELEVENLABS_API_KEY;
const liveTest = apiKey ? test : test.skip;

describe("live transcription", () => {
  liveTest(
    "transcribes the target Xiaoyuzhou episode with ElevenLabs",
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), "podcast-helper-live-"));

      try {
        const result = await transcribeInput({
          input: "https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2",
          outputDir,
          sourceAdapters: createDefaultSourceAdapters(),
          provider: createElevenLabsProvider({
            apiKey,
            model: "scribe_v2",
          }),
        });

        const txt = await readFile(result.artifacts.txt, "utf8");

        expect(txt.length).toBeGreaterThan(200);
        expect(txt).toContain("OpenClaw");
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    15 * 60 * 1000
  );
});
