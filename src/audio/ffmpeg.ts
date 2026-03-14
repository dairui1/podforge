import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

export interface AudioChunk {
  index: number;
  audioPath: string;
  offsetMs: number;
}

interface SplitAudioWithFfmpegOptions {
  audioPath: string;
  outputDir: string;
  chunkDurationSec: number;
  ffmpegExecutable?: string;
  runner?: CommandRunner;
}

interface CommandRunnerInput {
  command: string;
  args: string[];
}

type CommandRunner = (input: CommandRunnerInput) => Promise<void>;

export async function splitAudioWithFfmpeg(
  options: SplitAudioWithFfmpegOptions
): Promise<AudioChunk[]> {
  if (!Number.isFinite(options.chunkDurationSec) || options.chunkDurationSec <= 0) {
    throw new Error(`Invalid chunk duration: ${options.chunkDurationSec}`);
  }

  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const extension = extname(options.audioPath) || ".audio";
  const outputPattern = join(outputDir, `chunk-%03d${extension}`);
  const runner = options.runner ?? runCommand;

  await runner({
    command: options.ffmpegExecutable ?? "ffmpeg",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      options.audioPath,
      "-f",
      "segment",
      "-segment_time",
      String(options.chunkDurationSec),
      "-c",
      "copy",
      "-reset_timestamps",
      "1",
      outputPattern,
    ],
  });

  const files = (await readdir(outputDir))
    .filter((entry) => entry.startsWith("chunk-"))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error("ffmpeg did not produce any audio chunks.");
  }

  return files.map((entry, index) => ({
    index,
    audioPath: join(outputDir, entry),
    offsetMs: index * options.chunkDurationSec * 1000,
  }));
}

async function runCommand({ command, args }: CommandRunnerInput): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: process.env,
    });

    let stderr = "";
    child.on("error", reject);

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}`)
      );
    });
  });
}
