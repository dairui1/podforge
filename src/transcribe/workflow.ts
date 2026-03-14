import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { splitAudioWithFfmpeg, type AudioChunk } from "../audio/ffmpeg";
import { renderSrt, renderTxt } from "../output/transcript";
import type { SourceAdapter } from "../sources";
import type { SttProvider } from "./provider";
import type { TranscriptResult, TranscriptSegment, WorkflowEvent } from "./types";

interface AudioChunkerInput {
  audioPath: string;
  outputDir: string;
  chunkDurationSec: number;
}

type AudioChunker = (input: AudioChunkerInput) => Promise<AudioChunk[]>;

interface TranscribeInputOptions {
  input: string;
  outputDir: string;
  sourceAdapters: SourceAdapter[];
  provider: SttProvider;
  chunkDurationSec?: number;
  keepTemp?: boolean;
  tempRootDir?: string;
  audioChunker?: AudioChunker;
  onEvent?: (event: WorkflowEvent) => void;
}

export interface TranscribeResult {
  input: string;
  source: string;
  episodeId?: string;
  language?: string;
  sessionDir?: string;
  artifacts: {
    audio: string;
    srt: string;
    txt: string;
  };
}

interface MaterializedAudioArtifact {
  source: string;
  episodeId?: string;
  baseName: string;
  workingAudioPath: string;
  finalAudioPath: string;
}

export async function transcribeInput(options: TranscribeInputOptions): Promise<TranscribeResult> {
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const sessionRoot = resolve(options.tempRootDir ?? tmpdir());
  await mkdir(sessionRoot, { recursive: true });
  const sessionDir = await mkdtemp(join(sessionRoot, "podcast-helper-session-"));

  options.onEvent?.({
    type: "session.started",
    message: "Created transcription session workspace.",
    data: { sessionDir },
  });

  try {
    const audioArtifact = await materializeAudioInput({
      input: options.input,
      outputDir,
      sessionDir,
      sourceAdapters: options.sourceAdapters,
      onEvent: options.onEvent,
    });

    const chunks = await resolveAudioChunks({
      audioPath: audioArtifact.workingAudioPath,
      chunkDurationSec: resolveChunkDurationSec(options.chunkDurationSec, options.provider.name),
      sessionDir,
      audioChunker: options.audioChunker ?? splitAudioWithFfmpeg,
      onEvent: options.onEvent,
    });

    const mergedTranscript = await transcribeChunks({
      chunks,
      chunkCount: chunks.length,
      sessionDir,
      provider: options.provider,
      onEvent: options.onEvent,
    });

    const srtPath = join(outputDir, `${audioArtifact.baseName}.srt`);
    const txtPath = join(outputDir, `${audioArtifact.baseName}.txt`);

    await copyAudioArtifact(audioArtifact.workingAudioPath, audioArtifact.finalAudioPath);
    await writeFile(srtPath, renderSrt(mergedTranscript.segments), "utf8");
    await writeFile(
      txtPath,
      mergedTranscript.text || renderTxt(mergedTranscript.segments),
      "utf8"
    );

    options.onEvent?.({
      type: "write.completed",
      message: "Wrote transcript artifacts to disk.",
      data: { audioPath: audioArtifact.finalAudioPath, srtPath, txtPath },
    });

    return {
      input: options.input,
      source: audioArtifact.source,
      episodeId: audioArtifact.episodeId,
      language: mergedTranscript.language,
      sessionDir: options.keepTemp ? sessionDir : undefined,
      artifacts: {
        audio: audioArtifact.finalAudioPath,
        srt: srtPath,
        txt: txtPath,
      },
    };
  } finally {
    if (options.keepTemp) {
      options.onEvent?.({
        type: "cleanup.skipped",
        message: "Kept transcription session workspace on disk.",
        data: { sessionDir },
      });
    } else {
      await rm(sessionDir, { recursive: true, force: true });
      options.onEvent?.({
        type: "cleanup.completed",
        message: "Removed transcription session workspace.",
        data: { sessionDir },
      });
    }
  }
}

async function transcribeChunks(options: {
  chunks: AudioChunk[];
  chunkCount: number;
  sessionDir: string;
  provider: SttProvider;
  onEvent?: (event: WorkflowEvent) => void;
}): Promise<TranscriptResult> {
  const segments: TranscriptSegment[] = [];
  const textParts: string[] = [];
  let language: string | undefined;

  for (const chunk of options.chunks) {
    const chunkWorkDir = join(options.sessionDir, "transcripts", `chunk-${padChunkIndex(chunk.index)}`);
    await mkdir(chunkWorkDir, { recursive: true });

    options.onEvent?.({
      type: "chunk.started",
      message: `Transcribing chunk ${chunk.index + 1}/${options.chunkCount}.`,
      data: {
        chunkIndex: chunk.index,
        chunkCount: options.chunkCount,
        chunkPath: chunk.audioPath,
        offsetMs: chunk.offsetMs,
      },
    });

    const transcript = await options.provider.transcribe({
      audioPath: chunk.audioPath,
      workDir: chunkWorkDir,
      onEvent(event) {
        options.onEvent?.(decorateChunkEvent(event, chunk, options.chunkCount));
      },
    });

    language ??= transcript.language;
    segments.push(...offsetSegments(transcript.segments, chunk.offsetMs));

    const partialText = normalizeChunkText(transcript.text || renderTxt(transcript.segments));
    if (partialText.length > 0) {
      textParts.push(partialText);
      options.onEvent?.({
        type: "transcript.partial",
        message: `Received partial transcript for chunk ${chunk.index + 1}/${options.chunkCount}.`,
        data: {
          chunkIndex: chunk.index,
          chunkCount: options.chunkCount,
          offsetMs: chunk.offsetMs,
          text: partialText,
        },
      });
    }

    options.onEvent?.({
      type: "chunk.completed",
      message: `Completed chunk ${chunk.index + 1}/${options.chunkCount}.`,
      data: {
        chunkIndex: chunk.index,
        chunkCount: options.chunkCount,
        offsetMs: chunk.offsetMs,
      },
    });
  }

  return {
    text: textParts.length > 0 ? `${textParts.join("\n")}\n` : renderTxt(segments),
    segments,
    language,
  };
}

async function resolveAudioChunks(options: {
  audioPath: string;
  chunkDurationSec: number;
  sessionDir: string;
  audioChunker: AudioChunker;
  onEvent?: (event: WorkflowEvent) => void;
}): Promise<AudioChunk[]> {
  if (options.chunkDurationSec <= 0) {
    return [
      {
        index: 0,
        audioPath: options.audioPath,
        offsetMs: 0,
      },
    ];
  }

  const chunkOutputDir = join(options.sessionDir, "chunks");
  options.onEvent?.({
    type: "chunking.started",
    message: `Splitting audio into ${options.chunkDurationSec}-second chunks.`,
    data: { chunkDurationSec: options.chunkDurationSec },
  });

  const chunks = await options.audioChunker({
    audioPath: options.audioPath,
    outputDir: chunkOutputDir,
    chunkDurationSec: options.chunkDurationSec,
  });

  options.onEvent?.({
    type: "chunking.completed",
    message: `Prepared ${chunks.length} audio chunks.`,
    data: {
      chunkDurationSec: options.chunkDurationSec,
      chunkCount: chunks.length,
      chunksDir: chunkOutputDir,
    },
  });

  return chunks;
}

async function materializeAudioInput(options: {
  input: string;
  outputDir: string;
  sessionDir: string;
  sourceAdapters: SourceAdapter[];
  onEvent?: (event: WorkflowEvent) => void;
}): Promise<MaterializedAudioArtifact> {
  const sourceDir = join(options.sessionDir, "source");
  await mkdir(sourceDir, { recursive: true });

  if (looksLikeUrl(options.input)) {
    const adapter = options.sourceAdapters.find((candidate) => candidate.canResolve(options.input));
    if (!adapter) {
      const remoteAudio = resolveRemoteAudioInput(options.input);
      const fileName = `${remoteAudio.suggestedBaseName}${remoteAudio.audioExtension}`;
      const workingAudioPath = join(sourceDir, fileName);
      const finalAudioPath = join(options.outputDir, fileName);

      options.onEvent?.({
        type: "download.started",
        message: "Downloading remote audio.",
        data: { audioUrl: options.input },
      });

      await downloadAudio(options.input, workingAudioPath);

      options.onEvent?.({
        type: "download.completed",
        message: "Downloaded remote audio.",
        data: { audioPath: workingAudioPath },
      });

      return {
        source: remoteAudio.source,
        episodeId: remoteAudio.episodeId,
        baseName: remoteAudio.suggestedBaseName,
        workingAudioPath,
        finalAudioPath,
      };
    }

    options.onEvent?.({
      type: "resolve.started",
      message: "Resolving podcast episode metadata.",
      data: { input: options.input },
    });

    const resolved = await adapter.resolve(options.input);
    options.onEvent?.({
      type: "resolve.completed",
      message: "Resolved podcast episode metadata.",
      data: { source: resolved.source, episodeId: resolved.episodeId },
    });

    const extension =
      resolved.audioExtension || extname(new URL(resolved.audioUrl).pathname) || ".audio";
    const fileName = `${resolved.suggestedBaseName}${extension}`;
    const workingAudioPath = join(sourceDir, fileName);
    const finalAudioPath = join(options.outputDir, fileName);

    options.onEvent?.({
      type: "download.started",
      message: "Downloading source audio.",
      data: { audioUrl: resolved.audioUrl },
    });

    await downloadAudio(resolved.audioUrl, workingAudioPath);

    options.onEvent?.({
      type: "download.completed",
      message: "Downloaded source audio.",
      data: { audioPath: workingAudioPath },
    });

    return {
      source: resolved.source,
      episodeId: resolved.episodeId,
      baseName: resolved.suggestedBaseName,
      workingAudioPath,
      finalAudioPath,
    };
  }

  const originalPath = resolve(options.input);
  const extension = extname(originalPath) || ".audio";
  const baseName = basename(originalPath, extension);
  const fileName = `${baseName}${extension}`;
  const workingAudioPath = join(sourceDir, fileName);
  const finalAudioPath = join(options.outputDir, fileName);

  await copyFile(originalPath, workingAudioPath);

  return {
    source: "local-file",
    baseName,
    workingAudioPath,
    finalAudioPath,
  };
}

async function copyAudioArtifact(sourcePath: string, destinationPath: string): Promise<void> {
  if (sourcePath === destinationPath) {
    return;
  }

  await copyFile(sourcePath, destinationPath);
}

async function downloadAudio(audioUrl: string, destination: string): Promise<void> {
  if (audioUrl.startsWith("file://")) {
    await copyFile(fileURLToPath(audioUrl), destination);
    return;
  }

  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, buffer);
}

function resolveChunkDurationSec(
  chunkDurationSec: number | undefined,
  providerName: string
): number {
  if (typeof chunkDurationSec === "number") {
    return chunkDurationSec;
  }

  return providerName === "mlx-whisper" ? 300 : 0;
}

function offsetSegments(segments: TranscriptSegment[], offsetMs: number): TranscriptSegment[] {
  return segments.map((segment) => ({
    ...segment,
    startMs: segment.startMs + offsetMs,
    endMs: segment.endMs + offsetMs,
  }));
}

function decorateChunkEvent(
  event: WorkflowEvent,
  chunk: AudioChunk,
  chunkCount: number
): WorkflowEvent {
  return {
    ...event,
    data: {
      ...event.data,
      chunkIndex: chunk.index,
      chunkCount,
      chunkPath: chunk.audioPath,
      offsetMs: chunk.offsetMs,
    },
  };
}

function normalizeChunkText(text: string): string {
  return text.trim();
}

function padChunkIndex(index: number): string {
  return String(index).padStart(3, "0");
}

function looksLikeUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveRemoteAudioInput(input: string): {
  source: string;
  episodeId?: string;
  title?: string;
  suggestedBaseName: string;
  audioExtension: string;
} {
  const url = new URL(input);
  const pathname = url.pathname;
  const rawExtension = extname(pathname).toLowerCase();
  const audioExtension = rawExtension || ".audio";
  const rawBaseName = basename(pathname, rawExtension || undefined);
  const suggestedBaseName = sanitizeBaseName(rawBaseName || "remote-audio");

  return {
    source: "remote-audio-url",
    suggestedBaseName,
    audioExtension,
  };
}

function sanitizeBaseName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "remote-audio";
}
