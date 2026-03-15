import { createRequire } from "node:module";

import { Command } from "commander";

import {
  detectCliContext,
  isCommanderGracefulExit,
  normalizeCliError,
  renderCliErrorEnvelope,
  renderCliErrorEvent,
  renderCliErrorPlain,
  type CliProgressMode,
  wrapSuccessPayload,
} from "./cli-support";
import { createDefaultSourceAdapters } from "./sources";
import { createTranscriptionProvider } from "./transcribe/factory";
import {
  createDoctorReport,
  setupMlxWhisper,
  type DoctorReport,
  type SetupResult,
} from "./transcribe/mlx-whisper-runtime";
import type { WorkflowEvent } from "./transcribe/types";
import { transcribeInput } from "./transcribe/workflow";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
const cliContext = detectCliContext(process.argv.slice(2));

const program = new Command()
  .name("podcast-helper")
  .description("Download podcast audio and generate transcript artifacts.")
  .version(packageJson.version)
  .configureOutput({
    writeErr() {},
  })
  .exitOverride();

program
  .command("doctor")
  .description("Inspect the local environment for podcast-helper transcription.")
  .option(
    "--python-executable <path>",
    "Python interpreter to verify for local mlx-whisper runs"
  )
  .option("--json", "Print the doctor report as JSON", false)
  .action((options) => {
    const report = createDoctorReport({
      pythonExecutable: options.pythonExecutable,
    });

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(wrapSuccessPayload("doctor", report), null, 2)}\n`
      );
      return;
    }

    process.stdout.write(renderDoctorReport(report));
  });

program
  .command("setup")
  .description("Install local runtime dependencies for podcast-helper.")
  .argument("<target>", "Setup target. Currently supported: mlx-whisper")
  .option(
    "--python-executable <path>",
    "Base Python interpreter used to create the local mlx-whisper environment"
  )
  .option("--json", "Print the setup result as JSON", false)
  .action(async (target, options) => {
    if (target !== "mlx-whisper") {
      throw new Error(`Unsupported setup target: ${target}. Expected: mlx-whisper.`);
    }

    const result = await setupMlxWhisper({
      pythonExecutable: options.pythonExecutable,
      onProgress(message) {
        process.stderr.write(`${message}\n`);
      },
    });

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(wrapSuccessPayload("setup", result), null, 2)}\n`
      );
      return;
    }

    process.stdout.write(renderSetupResult(result));
  });

program
  .command("transcribe")
  .argument("<input>", "Episode URL, direct audio URL, or local audio file")
  .option("-o, --output-dir <dir>", "Directory for generated artifacts", process.cwd())
  .option(
    "--engine <engine>",
    "Transcription engine: auto, elevenlabs, openai, groq, deepgram, gladia, assemblyai, revai, or mlx-whisper",
    "auto"
  )
  .option(
    "--model <model>",
    "Transcription model. Hosted providers use provider-specific model ids; mlx-whisper uses a local path or Hugging Face repo."
  )
  .option("--language <code>", "Force transcription language")
  .option(
    "--python-executable <path>",
    "Python interpreter for local mlx-whisper runs. Defaults to auto-detection."
  )
  .option(
    "--chunk-duration <seconds>",
    "Chunk duration in seconds. Defaults to 300 for mlx-whisper and 0 for hosted providers; auto follows the selected engine."
  )
  .option("--keep-temp", "Keep the per-request temp workspace for debugging", false)
  .option(
    "--progress <mode>",
    "Progress output mode: plain, jsonl, or none",
    "plain"
  )
  .option("--json", "Print a machine-readable manifest to stdout", false)
  .action(async (input, options) => {
    const progressMode = parseProgressMode(options.progress);
    const result = await transcribeInput({
      input,
      outputDir: options.outputDir,
      sourceAdapters: createDefaultSourceAdapters(),
      provider: createTranscriptionProvider({
        engine: options.engine,
        model: options.model,
        languageCode: options.language,
        pythonExecutable: options.pythonExecutable,
      }),
      chunkDurationSec: parseChunkDuration(options.chunkDuration),
      keepTemp: Boolean(options.keepTemp),
      onEvent(event: WorkflowEvent) {
        renderWorkflowEvent(event, progressMode);
      },
    });

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(wrapSuccessPayload("transcribe", result), null, 2)}\n`
      );
      return;
    }

    process.stdout.write(`audio\t${result.artifacts.audio}\n`);
    process.stdout.write(`srt\t${result.artifacts.srt}\n`);
    process.stdout.write(`txt\t${result.artifacts.txt}\n`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (isCommanderGracefulExit(error)) {
    process.exitCode = 0;
    return;
  }

  const normalized = normalizeCliError(error, cliContext);

  if (cliContext.progressMode === "jsonl") {
    process.stderr.write(renderCliErrorEvent(cliContext.command, normalized));
  } else if (cliContext.json) {
    process.stderr.write(renderCliErrorEnvelope(cliContext.command, normalized));
  } else {
    process.stderr.write(renderCliErrorPlain(normalized));
  }

  process.exitCode = normalized.exitCode;
});

function parseChunkDuration(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid chunk duration: ${value}`);
  }

  return parsed;
}

function parseProgressMode(value: string): CliProgressMode {
  switch (value) {
    case "plain":
    case "jsonl":
    case "none":
      return value;
    default:
      throw new Error(`Invalid progress mode: ${value}. Expected plain, jsonl, or none.`);
  }
}

function renderWorkflowEvent(
  event: WorkflowEvent,
  mode: CliProgressMode
): void {
  if (mode === "none") {
    return;
  }

  if (mode === "jsonl") {
    process.stderr.write(`${JSON.stringify(event)}\n`);
    return;
  }

  if (event.type === "transcript.partial" && typeof event.data?.text === "string") {
    const chunkIndex = typeof event.data.chunkIndex === "number" ? event.data.chunkIndex + 1 : "?";
    const chunkCount = typeof event.data.chunkCount === "number" ? event.data.chunkCount : "?";
    process.stderr.write(`Partial transcript ${chunkIndex}/${chunkCount}: ${event.data.text}\n`);
    return;
  }

  process.stderr.write(`${event.message}\n`);
}

function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    `Platform: ${report.platform.os} ${report.platform.arch} (${report.platform.supported ? "Apple Silicon local transcription supported" : "hosted transcription recommended"})`,
    `Helper script: ${report.helperScript.ok ? report.helperScript.path : report.helperScript.error}`,
    `ffmpeg: ${report.ffmpeg.ok ? report.ffmpeg.path : "missing"}`,
    `python3: ${report.python3.ok ? report.python3.path : "missing"}`,
    `Configured Python: ${report.configuredPython.path} [${report.configuredPython.source}]`,
    `Default mlx-whisper venv: ${report.defaultVenv.path}${report.defaultVenv.exists ? " (present)" : " (missing)"}`,
    `mlx-whisper: ${report.mlxWhisper.available ? "available" : "not available"}`,
    `Recommended engine: ${report.recommendedEngine}`,
    `Remote keys: ${Object.entries(report.remoteKeys)
      .map(([envVar, present]) => `${envVar}=${present ? "present" : "missing"}`)
      .join(", ")}`,
  ];

  if (report.nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderSetupResult(result: SetupResult): string {
  const lines = [
    "Local mlx-whisper setup completed.",
    `Target: ${result.target}`,
    `Venv: ${result.venvDir}`,
    `Python: ${result.pythonExecutable}`,
    `ffmpeg: ${result.ffmpegPath}`,
    `Helper script: ${result.helperScriptPath}`,
    "",
    "The CLI will auto-detect this install on future runs.",
  ];

  return `${lines.join("\n")}\n`;
}
