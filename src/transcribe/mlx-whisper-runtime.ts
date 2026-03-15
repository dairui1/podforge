import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CommandFinder = (command: string) => string | undefined;

type AvailabilityCheck = (options?: {
  pythonExecutable?: string;
  helperScriptPath?: string;
}) => boolean;

type CommandRunner = (input: {
  command: string;
  args: string[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}) => Promise<{
  stdout: string;
  stderr: string;
}>;

type PythonSource =
  | "explicit"
  | "env:PODCAST_HELPER_PYTHON"
  | "env:MLX_WHISPER_PYTHON"
  | "default-venv"
  | "fallback";

export interface MlxWhisperPythonResolution {
  path: string;
  source: PythonSource;
}

export interface DoctorReport {
  platform: {
    os: string;
    arch: string;
    supported: boolean;
  };
  helperScript: {
    ok: boolean;
    path?: string;
    error?: string;
  };
  ffmpeg: {
    ok: boolean;
    path?: string;
  };
  python3: {
    ok: boolean;
    path?: string;
  };
  configuredPython: MlxWhisperPythonResolution & {
    exists: boolean;
  };
  defaultVenv: {
    path: string;
    exists: boolean;
  };
  mlxWhisper: {
    available: boolean;
    pythonExecutable: string;
  };
  remoteKeys: Record<string, boolean>;
  recommendedEngine: string;
  nextSteps: string[];
}

export interface SetupResult {
  target: "mlx-whisper";
  venvDir: string;
  pythonExecutable: string;
  ffmpegPath: string;
  helperScriptPath: string;
}

const REMOTE_PROVIDER_ENV_VARS = [
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "DEEPGRAM_API_KEY",
  "GLADIA_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "REVAI_API_KEY",
] as const;

export function getPodcastHelperHome(): string {
  const configuredHome = process.env.PODCAST_HELPER_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : resolve(homedir(), ".podcast-helper");
}

export function getDefaultMlxWhisperVenvDir(): string {
  return resolve(getPodcastHelperHome(), "venvs", "mlx-whisper");
}

export function getDefaultMlxWhisperPythonPath(): string {
  return resolve(getDefaultMlxWhisperVenvDir(), "bin", "python");
}

export function resolveMlxWhisperPythonExecutable(
  pythonExecutable?: string
): string {
  return resolveMlxWhisperPython(pythonExecutable).path;
}

export function resolveMlxWhisperPython(
  pythonExecutable?: string
): MlxWhisperPythonResolution {
  if (pythonExecutable) {
    return {
      path: pythonExecutable,
      source: "explicit",
    };
  }

  const podcastHelperPython = process.env.PODCAST_HELPER_PYTHON?.trim();
  if (podcastHelperPython) {
    return {
      path: podcastHelperPython,
      source: "env:PODCAST_HELPER_PYTHON",
    };
  }

  const mlxWhisperPython = process.env.MLX_WHISPER_PYTHON?.trim();
  if (mlxWhisperPython) {
    return {
      path: mlxWhisperPython,
      source: "env:MLX_WHISPER_PYTHON",
    };
  }

  const defaultVenvPython = getDefaultMlxWhisperPythonPath();
  if (existsSync(defaultVenvPython)) {
    return {
      path: defaultVenvPython,
      source: "default-venv",
    };
  }

  return {
    path: "python3",
    source: "fallback",
  };
}

export function resolveMlxWhisperHelperScriptPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, "../../scripts/mlx_whisper_transcribe.py"),
    resolve(currentDir, "../scripts/mlx_whisper_transcribe.py"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate mlx_whisper_transcribe.py in the installed package.");
}

export function isAppleSiliconMac(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

export function isMlxWhisperAvailable(options: {
  pythonExecutable?: string;
  helperScriptPath?: string;
} = {}): boolean {
  try {
    const pythonExecutable = resolveMlxWhisperPythonExecutable(options.pythonExecutable);
    const helperScriptPath =
      options.helperScriptPath ?? resolveMlxWhisperHelperScriptPath();

    if (!existsSync(helperScriptPath)) {
      return false;
    }

    const result = spawnSync(
      pythonExecutable,
      [
        "-c",
        "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('mlx_whisper') else 1)",
      ],
      {
        env: process.env,
        encoding: "utf8",
        stdio: "ignore",
        timeout: 10_000,
      }
    );

    return result.status === 0;
  } catch {
    return false;
  }
}

export function createDoctorReport(options: {
  pythonExecutable?: string;
  helperScriptPath?: string;
  commandFinder?: CommandFinder;
  availabilityCheck?: AvailabilityCheck;
  platformSupported?: boolean;
} = {}): DoctorReport {
  const commandFinder = options.commandFinder ?? findCommandInPath;
  const availabilityCheck = options.availabilityCheck ?? isMlxWhisperAvailable;
  const platformSupported = options.platformSupported ?? isAppleSiliconMac();
  const helperScriptPath = resolveHelperScriptInfo(options.helperScriptPath);
  const python = resolveMlxWhisperPython(options.pythonExecutable);
  const ffmpegPath = commandFinder("ffmpeg");
  const python3Path = commandFinder("python3");
  const defaultVenvPython = getDefaultMlxWhisperPythonPath();
  const remoteKeys = Object.fromEntries(
    REMOTE_PROVIDER_ENV_VARS.map((envVar) => [envVar, Boolean(process.env[envVar]?.trim())])
  );

  const mlxWhisperAvailable =
    helperScriptPath.ok &&
    availabilityCheck({
      pythonExecutable: python.path,
      helperScriptPath: helperScriptPath.path,
    });
  const recommendedEngine = resolveRecommendedEngine(remoteKeys, mlxWhisperAvailable);
  const nextSteps = buildDoctorNextSteps({
    ffmpegAvailable: Boolean(ffmpegPath),
    python3Available: Boolean(python3Path),
    mlxWhisperAvailable,
    platformSupported,
    remoteKeys,
  });

  return {
    platform: {
      os: process.platform,
      arch: process.arch,
      supported: platformSupported,
    },
    helperScript: helperScriptPath,
    ffmpeg: {
      ok: Boolean(ffmpegPath),
      path: ffmpegPath,
    },
    python3: {
      ok: Boolean(python3Path),
      path: python3Path,
    },
    configuredPython: {
      ...python,
      exists: python.path === "python3" ? Boolean(python3Path) : existsSync(python.path),
    },
    defaultVenv: {
      path: defaultVenvPython,
      exists: existsSync(defaultVenvPython),
    },
    mlxWhisper: {
      available: mlxWhisperAvailable,
      pythonExecutable: python.path,
    },
    remoteKeys,
    recommendedEngine,
    nextSteps,
  };
}

export async function setupMlxWhisper(options: {
  pythonExecutable?: string;
  venvDir?: string;
  helperScriptPath?: string;
  commandFinder?: CommandFinder;
  commandRunner?: CommandRunner;
  availabilityCheck?: AvailabilityCheck;
  onProgress?: (message: string) => void;
  platformSupported?: boolean;
} = {}): Promise<SetupResult> {
  const commandFinder = options.commandFinder ?? findCommandInPath;
  const commandRunner = options.commandRunner ?? runCommand;
  const availabilityCheck = options.availabilityCheck ?? isMlxWhisperAvailable;

  const platformSupported = options.platformSupported ?? isAppleSiliconMac();

  if (!platformSupported) {
    throw new Error("mlx-whisper setup currently supports Apple Silicon macOS only.");
  }

  const ffmpegPath = commandFinder("ffmpeg");
  if (!ffmpegPath) {
    throw new Error("ffmpeg is required. Install it first with `brew install ffmpeg`.");
  }

  const configuredPodcastHelperPython = process.env.PODCAST_HELPER_PYTHON?.trim();
  const configuredMlxWhisperPython = process.env.MLX_WHISPER_PYTHON?.trim();
  const basePython =
    options.pythonExecutable ??
    (configuredPodcastHelperPython || undefined) ??
    (configuredMlxWhisperPython || undefined) ??
    commandFinder("python3");
  if (!basePython) {
    throw new Error("python3 is required. Install Python 3 first, then retry setup.");
  }

  const helperScriptInfo = resolveHelperScriptInfo(options.helperScriptPath);
  if (!helperScriptInfo.ok || !helperScriptInfo.path) {
    throw new Error(helperScriptInfo.error ?? "Could not locate mlx_whisper_transcribe.py.");
  }

  const venvDir = resolve(options.venvDir ?? getDefaultMlxWhisperVenvDir());
  const venvPython = resolve(venvDir, "bin", "python");

  await mkdir(dirname(venvDir), { recursive: true });

  options.onProgress?.(`Creating virtual environment at ${venvDir}`);
  await commandRunner({
    command: basePython,
    args: ["-m", "venv", venvDir],
    onStdoutLine: options.onProgress,
    onStderrLine: options.onProgress,
  });

  options.onProgress?.("Upgrading pip in the mlx-whisper environment");
  await commandRunner({
    command: venvPython,
    args: ["-m", "pip", "install", "--upgrade", "pip"],
    onStdoutLine: options.onProgress,
    onStderrLine: options.onProgress,
  });

  options.onProgress?.("Installing mlx-whisper");
  await commandRunner({
    command: venvPython,
    args: ["-m", "pip", "install", "mlx-whisper"],
    onStdoutLine: options.onProgress,
    onStderrLine: options.onProgress,
  });

  const installed =
    availabilityCheck({
      pythonExecutable: venvPython,
      helperScriptPath: helperScriptInfo.path,
    }) && existsSync(venvPython);
  if (!installed) {
    throw new Error("mlx-whisper installation finished, but the runtime could not be verified.");
  }

  return {
    target: "mlx-whisper",
    venvDir,
    pythonExecutable: venvPython,
    ffmpegPath,
    helperScriptPath: helperScriptInfo.path,
  };
}

function resolveRecommendedEngine(
  remoteKeys: Record<string, boolean>,
  mlxWhisperAvailable: boolean
): string {
  if (mlxWhisperAvailable) {
    return "mlx-whisper";
  }

  if (remoteKeys.ELEVENLABS_API_KEY) {
    return "elevenlabs";
  }

  if (remoteKeys.OPENAI_API_KEY) {
    return "openai";
  }

  if (remoteKeys.GROQ_API_KEY) {
    return "groq";
  }

  if (remoteKeys.DEEPGRAM_API_KEY) {
    return "deepgram";
  }

  if (remoteKeys.GLADIA_API_KEY) {
    return "gladia";
  }

  if (remoteKeys.ASSEMBLYAI_API_KEY) {
    return "assemblyai";
  }

  if (remoteKeys.REVAI_API_KEY) {
    return "revai";
  }

  return "mlx-whisper";
}

function buildDoctorNextSteps(options: {
  ffmpegAvailable: boolean;
  python3Available: boolean;
  mlxWhisperAvailable: boolean;
  platformSupported: boolean;
  remoteKeys: Record<string, boolean>;
}): string[] {
  const nextSteps: string[] = [];

  if (!options.platformSupported) {
    nextSteps.push("Use a hosted provider API key or switch to an Apple Silicon Mac for mlx-whisper.");
  }

  if (!options.ffmpegAvailable) {
    nextSteps.push("Install ffmpeg with `brew install ffmpeg`.");
  }

  if (!options.python3Available) {
    nextSteps.push("Install Python 3 so `python3` is available on your PATH.");
  }

  if (
    options.platformSupported &&
    options.ffmpegAvailable &&
    options.python3Available &&
    !options.mlxWhisperAvailable
  ) {
    nextSteps.push("Run `podcast-helper setup mlx-whisper` to install the local transcription runtime.");
  }

  if (!Object.values(options.remoteKeys).some(Boolean) && !options.mlxWhisperAvailable) {
    nextSteps.push("Set one hosted provider API key, or install local mlx-whisper before running transcription.");
  }

  return nextSteps;
}

function resolveHelperScriptInfo(
  helperScriptPath?: string
): DoctorReport["helperScript"] {
  try {
    const path = helperScriptPath ?? resolveMlxWhisperHelperScriptPath();
    return {
      ok: existsSync(path),
      path,
      error: existsSync(path) ? undefined : "mlx_whisper_transcribe.py is missing.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function findCommandInPath(command: string): string | undefined {
  const result = spawnSync("which", [command], {
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    return undefined;
  }

  const resolvedPath = result.stdout.trim();
  return resolvedPath.length > 0 ? resolvedPath : undefined;
}

async function runCommand(input: {
  command: string;
  args: string[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(input.command, input.args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.on("error", reject);

    child.stdout.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stdout += value;
      stdoutBuffer += value;

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          input.onStdoutLine?.(line);
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const value = chunk.toString();
      stderr += value;
      stderrBuffer += value;

      let newlineIndex = stderrBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stderrBuffer.slice(0, newlineIndex).trim();
        stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          input.onStderrLine?.(line);
        }
        newlineIndex = stderrBuffer.indexOf("\n");
      }
    });

    child.on("close", (code) => {
      if (stdoutBuffer.trim().length > 0) {
        input.onStdoutLine?.(stdoutBuffer.trim());
      }

      if (stderrBuffer.trim().length > 0) {
        input.onStderrLine?.(stderrBuffer.trim());
      }

      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Process exited with code ${code}`));
    });
  });
}
