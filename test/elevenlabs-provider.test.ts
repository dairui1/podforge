import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createElevenLabsProvider } from "../src/transcribe/elevenlabs";

describe("ElevenLabs transcription provider", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "podforge-elevenlabs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("maps ElevenLabs word timings into grouped subtitle segments", async () => {
    const audioPath = join(tempDir, "audio.wav");
    await writeFile(audioPath, Buffer.from("not-a-real-audio-file"));

    const provider = createElevenLabsProvider({
      apiKey: "test-api-key",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
        expect(init?.method).toBe("POST");

        return new Response(
          JSON.stringify({
            language_code: "zh",
            language_probability: 0.99,
            text: "你好 世界。",
            words: [
              { text: "你好", type: "word", start: 0.0, end: 0.4 },
              { text: " ", type: "spacing", start: null, end: null },
              { text: "世界。", type: "word", start: 0.5, end: 1.2 },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        );
      },
    });

    const result = await provider.transcribe({ audioPath });

    expect(result.language).toBe("zh");
    expect(result.text).toBe("你好 世界。\n");
    expect(result.segments).toEqual([
      {
        startMs: 0,
        endMs: 1200,
        text: "你好 世界。",
      },
    ]);
  });
});
