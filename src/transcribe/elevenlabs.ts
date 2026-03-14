import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { experimental_transcribe as transcribe } from "ai";

import type { SttProvider } from "./provider";
import type { TranscriptResult, TranscriptSegment, WorkflowEvent } from "./types";

interface ElevenLabsWord {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start?: number | null;
  end?: number | null;
}

interface CreateElevenLabsProviderOptions {
  apiKey?: string;
  model?: string;
  languageCode?: string;
  diarize?: boolean;
  maxSubtitleDurationMs?: number;
  maxSubtitleChars?: number;
  gapThresholdMs?: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export function createElevenLabsProvider(
  options: CreateElevenLabsProviderOptions = {}
): SttProvider {
  const provider = createElevenLabs({
    apiKey: options.apiKey,
    fetch: options.fetch as typeof fetch | undefined,
  });

  return {
    name: "elevenlabs",
    async transcribe({
      audioPath,
      onEvent,
    }: {
      audioPath: string;
      onEvent?: (event: WorkflowEvent) => void;
    }): Promise<TranscriptResult> {
      onEvent?.({
        type: "transcribe.started",
        message: "Submitting audio to ElevenLabs.",
        data: { provider: "elevenlabs" },
      });

      const audio = await readFile(audioPath);
      const result = await transcribe({
        model: provider.transcription(options.model ?? "scribe_v2"),
        audio: new Uint8Array(audio),
        providerOptions: {
          elevenlabs: {
            languageCode: options.languageCode,
            diarize: options.diarize ?? true,
            timestampsGranularity: "word",
            tagAudioEvents: true,
          },
        },
      });

      const firstResponse = result.responses.at(0) as { body?: unknown } | undefined;
      const words = extractWords(firstResponse?.body);
      const segments =
        words.length > 0
          ? groupWordsIntoSubtitleSegments(words, {
              maxSubtitleDurationMs: options.maxSubtitleDurationMs,
              maxSubtitleChars: options.maxSubtitleChars,
              gapThresholdMs: options.gapThresholdMs,
            })
          : result.segments.map((segment) => ({
              startMs: Math.round(segment.startSecond * 1000),
              endMs: Math.round(segment.endSecond * 1000),
              text: segment.text,
            }));

      const transcript = normalizeTranscriptText(result.text);

      onEvent?.({
        type: "transcribe.completed",
        message: "Received transcript from ElevenLabs.",
        data: {
          provider: "elevenlabs",
          segments: segments.length,
          language: result.language ?? "",
        },
      });

      return {
        text: transcript,
        segments,
        language: result.language,
      };
    },
  };
}

function extractWords(rawBody: unknown): ElevenLabsWord[] {
  const body = typeof rawBody === "string" ? safeJsonParse(rawBody) : rawBody;
  if (!isRecord(body) || !Array.isArray(body.words)) {
    return [];
  }

  return body.words.flatMap((word): ElevenLabsWord[] => {
    if (!isRecord(word) || typeof word.text !== "string") {
      return [];
    }

    const type = word.type === "spacing" || word.type === "audio_event" ? word.type : "word";

    return [
      {
        text: word.text,
        type,
        start: typeof word.start === "number" ? word.start : null,
        end: typeof word.end === "number" ? word.end : null,
      },
    ];
  });
}

function groupWordsIntoSubtitleSegments(
  words: ElevenLabsWord[],
  options: {
    maxSubtitleDurationMs?: number;
    maxSubtitleChars?: number;
    gapThresholdMs?: number;
  }
): TranscriptSegment[] {
  const maxSubtitleDurationMs = options.maxSubtitleDurationMs ?? 5000;
  const maxSubtitleChars = options.maxSubtitleChars ?? 84;
  const gapThresholdMs = options.gapThresholdMs ?? 1200;
  const segments: TranscriptSegment[] = [];

  let currentText = "";
  let currentStartMs: number | null = null;
  let currentEndMs: number | null = null;

  const flush = () => {
    const text = currentText.trim();
    if (text && currentStartMs !== null && currentEndMs !== null) {
      segments.push({
        startMs: currentStartMs,
        endMs: Math.max(currentEndMs, currentStartMs),
        text,
      });
    }

    currentText = "";
    currentStartMs = null;
    currentEndMs = null;
  };

  for (const word of words) {
    if (word.type === "audio_event") {
      flush();
      continue;
    }

    if (word.type === "spacing") {
      currentText += word.text;
      continue;
    }

    const startMs = Math.round((word.start ?? 0) * 1000);
    const endMs = Math.round((word.end ?? word.start ?? 0) * 1000);

    if (currentStartMs === null) {
      currentStartMs = startMs;
    }

    const gap = currentEndMs === null ? 0 : startMs - currentEndMs;
    const candidateText = `${currentText}${word.text}`;
    const duration = endMs - currentStartMs;
    const shouldFlush =
      gap > gapThresholdMs ||
      duration > maxSubtitleDurationMs ||
      candidateText.trim().length > maxSubtitleChars ||
      (isSentenceBoundary(word.text) && duration >= 1600);

    if (shouldFlush && currentText.trim().length > 0) {
      flush();
      currentStartMs = startMs;
    }

    currentText += word.text;
    currentEndMs = endMs;
  }

  flush();
  return segments;
}

function normalizeTranscriptText(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isSentenceBoundary(value: string): boolean {
  return /[.!?。！？]$/.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inferAudioExtension(audioPath: string): string {
  const ext = extname(audioPath).toLowerCase();
  return ext || ".audio";
}
