import { CommanderError } from "commander";

export type CliCommandName = "doctor" | "setup" | "transcribe" | "unknown";
export type CliProgressMode = "plain" | "jsonl" | "none";
type CliErrorCategory = "usage" | "dependency" | "network" | "source" | "transcription" | "internal";

export interface CliContext {
  command: CliCommandName;
  json: boolean;
  progressMode: CliProgressMode;
}

export interface CliErrorShape {
  code: string;
  category: CliErrorCategory;
  message: string;
  hints: string[];
  details?: Record<string, string | number | boolean | null>;
}

export class PodcastHelperCliError extends Error {
  readonly code: string;
  readonly category: CliErrorCategory;
  readonly hints: string[];
  readonly details?: Record<string, string | number | boolean | null>;
  readonly exitCode: number;

  constructor(input: {
    code: string;
    category: CliErrorCategory;
    message: string;
    hints?: string[];
    details?: Record<string, string | number | boolean | null>;
    exitCode?: number;
  }) {
    super(input.message);
    this.name = "PodcastHelperCliError";
    this.code = input.code;
    this.category = input.category;
    this.hints = input.hints ?? [];
    this.details = input.details;
    this.exitCode = input.exitCode ?? 1;
  }
}

export function detectCliContext(argv: string[]): CliContext {
  return {
    command: detectCommand(argv),
    json: hasFlag(argv, "--json"),
    progressMode: detectProgressMode(argv),
  };
}

export function wrapSuccessPayload<T extends object>(
  command: CliCommandName,
  payload: T
): T & { ok: true; command: CliCommandName } {
  return {
    ok: true,
    command,
    ...payload,
  };
}

export function normalizeCliError(
  error: unknown,
  context: CliContext
): PodcastHelperCliError {
  if (error instanceof PodcastHelperCliError) {
    return error;
  }

  if (error instanceof CommanderError) {
    return normalizeCommanderError(error, context);
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/Unsupported setup target:/.test(message)) {
    return new PodcastHelperCliError({
      code: "UNSUPPORTED_SETUP_TARGET",
      category: "usage",
      message,
      hints: ["Use `podforge setup mlx-whisper`."],
      exitCode: 2,
    });
  }

  if (/Invalid chunk duration:/.test(message)) {
    return new PodcastHelperCliError({
      code: "INVALID_CHUNK_DURATION",
      category: "usage",
      message,
      hints: [
        "Use a non-negative number.",
        "Use `--chunk-duration 300` for five-minute chunks or `--chunk-duration 0` to disable chunking.",
      ],
      exitCode: 2,
    });
  }

  if (/Invalid progress mode:/.test(message)) {
    return new PodcastHelperCliError({
      code: "INVALID_PROGRESS_MODE",
      category: "usage",
      message,
      hints: ["Use `--progress plain`, `--progress jsonl`, or `--progress none`."],
      exitCode: 2,
    });
  }

  if (/Unsupported transcription engine:/.test(message)) {
    return new PodcastHelperCliError({
      code: "UNSUPPORTED_ENGINE",
      category: "usage",
      message,
      hints: [
        "Use `auto`, `elevenlabs`, `openai`, `groq`, `deepgram`, `gladia`, `assemblyai`, `revai`, or `mlx-whisper`.",
      ],
      exitCode: 2,
    });
  }

  if (/mlx-whisper setup currently supports Apple Silicon macOS only\./.test(message)) {
    return new PodcastHelperCliError({
      code: "UNSUPPORTED_PLATFORM",
      category: "dependency",
      message,
      hints: [
        "Use a hosted transcription provider on this machine.",
        "Run local `mlx-whisper` on an Apple Silicon Mac.",
      ],
      exitCode: 3,
    });
  }

  if (/ffmpeg is required\./.test(message)) {
    return new PodcastHelperCliError({
      code: "FFMPEG_MISSING",
      category: "dependency",
      message,
      hints: ["Install ffmpeg with `brew install ffmpeg`, then rerun the command."],
      exitCode: 3,
    });
  }

  if (/python3 is required\./.test(message)) {
    return new PodcastHelperCliError({
      code: "PYTHON3_MISSING",
      category: "dependency",
      message,
      hints: ["Install Python 3 so `python3` is available on PATH, then rerun the command."],
      exitCode: 3,
    });
  }

  if (/mlx-whisper is not available\./.test(message)) {
    return new PodcastHelperCliError({
      code: "MLX_WHISPER_UNAVAILABLE",
      category: "dependency",
      message,
      hints: [
        "Run `podforge doctor` to inspect the local runtime.",
        "Run `podforge setup mlx-whisper` to install the local runtime.",
      ],
      exitCode: 3,
    });
  }

  if (/Failed to download audio:/.test(message)) {
    return new PodcastHelperCliError({
      code: "AUDIO_DOWNLOAD_FAILED",
      category: "network",
      message,
      hints: [
        "Verify that the URL is reachable from this machine.",
        "If the page is not a public episode page, pass a direct audio URL instead.",
      ],
      exitCode: 4,
    });
  }

  if (
    /Could not extract podcast audio from the provided page\./.test(message) ||
    /Could not find __NEXT_DATA__ in Xiaoyuzhou page\./.test(message) ||
    /Could not locate Xiaoyuzhou episode payload\./.test(message) ||
    /Could not extract Xiaoyuzhou audio URL\./.test(message)
  ) {
    return new PodcastHelperCliError({
      code: "SOURCE_RESOLUTION_FAILED",
      category: "source",
      message,
      hints: [
        "Pass the original episode page URL, a direct audio URL, or a local audio file.",
        "If this site hides audio metadata, download the audio separately and rerun `transcribe` with the file path.",
      ],
      exitCode: 4,
    });
  }

  if (
    /No API key/.test(message) ||
    /401/.test(message) ||
    /403/.test(message) ||
    /Unauthorized/.test(message) ||
    /Forbidden/.test(message)
  ) {
    return new PodcastHelperCliError({
      code: "PROVIDER_AUTH_FAILED",
      category: "transcription",
      message,
      hints: [
        "Verify the API key for the selected hosted provider.",
        "Use `--engine mlx-whisper` on Apple Silicon if you want a local fallback.",
      ],
      exitCode: 4,
    });
  }

  if (
    /did not return any timestamped segments/.test(message) ||
    /returned malformed JSON/.test(message) ||
    /Process exited with code/.test(message)
  ) {
    return new PodcastHelperCliError({
      code: "TRANSCRIPTION_FAILED",
      category: "transcription",
      message,
      hints: [
        "Retry with `--progress jsonl` to inspect per-stage events.",
        "If local transcription was selected, run `podforge doctor` to verify the runtime.",
      ],
      exitCode: 4,
    });
  }

  return new PodcastHelperCliError({
    code: "UNEXPECTED_ERROR",
    category: "internal",
    message,
    hints: [
      "Retry with `--json` for a machine-readable result envelope.",
      context.command === "transcribe"
        ? "Retry with `--progress jsonl` to capture the event stream."
        : "Run the command again after checking the current environment.",
    ],
    exitCode: 1,
  });
}

export function renderCliErrorEnvelope(
  command: CliCommandName,
  error: PodcastHelperCliError
): string {
  return `${JSON.stringify(
    {
      ok: false,
      command,
      error: toCliErrorShape(error),
    },
    null,
    2
  )}\n`;
}

export function renderCliErrorPlain(error: PodcastHelperCliError): string {
  const lines = [`Error [${error.code}]: ${error.message}`];

  if (error.hints.length > 0) {
    lines.push("");
    lines.push("Hints:");
    for (const hint of error.hints) {
      lines.push(`- ${hint}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderCliErrorEvent(
  command: CliCommandName,
  error: PodcastHelperCliError
): string {
  return `${JSON.stringify({
    type: "error",
    message: error.message,
    data: {
      command,
      code: error.code,
      category: error.category,
      hints: error.hints,
    },
  })}\n`;
}

export function isCommanderGracefulExit(error: unknown): boolean {
  return (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  );
}

function toCliErrorShape(error: PodcastHelperCliError): CliErrorShape {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    hints: error.hints,
    details: error.details,
  };
}

function normalizeCommanderError(
  error: CommanderError,
  context: CliContext
): PodcastHelperCliError {
  if (error.code === "commander.unknownOption") {
    return new PodcastHelperCliError({
      code: "UNKNOWN_OPTION",
      category: "usage",
      message: error.message.replace(/^error:\s*/i, ""),
      hints: [buildHelpHint(context.command)],
      exitCode: 2,
    });
  }

  if (error.code === "commander.missingArgument") {
    return new PodcastHelperCliError({
      code: "MISSING_ARGUMENT",
      category: "usage",
      message: error.message.replace(/^error:\s*/i, ""),
      hints: [buildHelpHint(context.command)],
      exitCode: 2,
    });
  }

  if (error.code === "commander.unknownCommand") {
    return new PodcastHelperCliError({
      code: "UNKNOWN_COMMAND",
      category: "usage",
      message: error.message.replace(/^error:\s*/i, ""),
      hints: ["Use `podforge --help` to list available commands."],
      exitCode: 2,
    });
  }

  return new PodcastHelperCliError({
    code: "CLI_USAGE_ERROR",
    category: "usage",
    message: error.message.replace(/^error:\s*/i, ""),
    hints: [buildHelpHint(context.command)],
    exitCode: 2,
  });
}

function buildHelpHint(command: CliCommandName): string {
  if (command === "unknown") {
    return "Use `podforge --help` for usage.";
  }

  return `Use \`podforge ${command} --help\` for usage.`;
}

function detectCommand(argv: string[]): CliCommandName {
  for (const value of argv) {
    if (!value.startsWith("-")) {
      if (value === "doctor" || value === "setup" || value === "transcribe") {
        return value;
      }

      return "unknown";
    }
  }

  return "unknown";
}

function detectProgressMode(argv: string[]): CliProgressMode {
  const explicitValue = readFlagValue(argv, "--progress");
  if (explicitValue === "plain" || explicitValue === "jsonl" || explicitValue === "none") {
    return explicitValue;
  }

  return "plain";
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === flag) {
      return argv[index + 1];
    }

    if (value.startsWith(`${flag}=`)) {
      return value.slice(flag.length + 1);
    }
  }

  return undefined;
}
