import { CommanderError } from "commander";
import { describe, expect, test } from "vitest";

import {
  detectCliContext,
  isCommanderGracefulExit,
  normalizeCliError,
  renderCliErrorEnvelope,
  renderCliErrorEvent,
  renderCliErrorPlain,
  wrapSuccessPayload,
} from "../src/cli-support";

describe("cli support", () => {
  test("detects command, json mode, and progress mode from argv", () => {
    expect(
      detectCliContext(["transcribe", "episode.mp3", "--json", "--progress", "jsonl"])
    ).toEqual({
      command: "transcribe",
      json: true,
      progressMode: "jsonl",
    });
  });

  test("wraps success payloads with a stable envelope", () => {
    expect(
      wrapSuccessPayload("setup", {
        target: "mlx-whisper",
      })
    ).toEqual({
      ok: true,
      command: "setup",
      target: "mlx-whisper",
    });
  });

  test("normalizes commander usage errors with actionable hints", () => {
    const error = normalizeCliError(
      new CommanderError(
        1,
        "commander.missingArgument",
        "error: missing required argument 'input'"
      ),
      {
        command: "transcribe",
        json: false,
        progressMode: "plain",
      }
    );

    expect(error.code).toBe("MISSING_ARGUMENT");
    expect(error.exitCode).toBe(2);
    expect(error.hints).toContain("Use `podforge transcribe --help` for usage.");
  });

  test("normalizes mlx-whisper setup dependency errors", () => {
    const error = normalizeCliError(
      new Error("ffmpeg is required. Install it first with `brew install ffmpeg`."),
      {
        command: "setup",
        json: true,
        progressMode: "plain",
      }
    );

    expect(error.code).toBe("FFMPEG_MISSING");
    expect(error.category).toBe("dependency");
    expect(error.exitCode).toBe(3);
  });

  test("renders json error envelopes for agents", () => {
    const error = normalizeCliError(
      new Error("mlx-whisper is not available. Run `podforge doctor` to inspect your environment, then `podforge setup mlx-whisper` to install the local runtime."),
      {
        command: "transcribe",
        json: true,
        progressMode: "plain",
      }
    );

    expect(JSON.parse(renderCliErrorEnvelope("transcribe", error))).toEqual({
      ok: false,
      command: "transcribe",
      error: {
        code: "MLX_WHISPER_UNAVAILABLE",
        category: "dependency",
        message:
          "mlx-whisper is not available. Run `podforge doctor` to inspect your environment, then `podforge setup mlx-whisper` to install the local runtime.",
        hints: [
          "Run `podforge doctor` to inspect the local runtime.",
          "Run `podforge setup mlx-whisper` to install the local runtime.",
        ],
      },
    });
  });

  test("renders jsonl error events for progress streams", () => {
    const error = normalizeCliError(
      new Error(
        "Could not extract podcast audio from the provided page."
      ),
      {
        command: "transcribe",
        json: false,
        progressMode: "jsonl",
      }
    );

    expect(JSON.parse(renderCliErrorEvent("transcribe", error))).toEqual({
      type: "error",
      message: "Could not extract podcast audio from the provided page.",
      data: {
        command: "transcribe",
        code: "SOURCE_RESOLUTION_FAILED",
        category: "source",
        hints: [
          "Pass the original episode page URL, a direct audio URL, or a local audio file.",
          "If this site hides audio metadata, download the audio separately and rerun `transcribe` with the file path.",
        ],
      },
    });
  });

  test("renders plain errors with code and hints", () => {
    const error = normalizeCliError(
      new Error("Invalid progress mode: xml. Expected plain, jsonl, or none."),
      {
        command: "transcribe",
        json: false,
        progressMode: "plain",
      }
    );

    expect(renderCliErrorPlain(error)).toContain("Error [INVALID_PROGRESS_MODE]");
    expect(renderCliErrorPlain(error)).toContain(
      "Use `--progress plain`, `--progress jsonl`, or `--progress none`."
    );
  });

  test("detects commander help exits as graceful", () => {
    expect(
      isCommanderGracefulExit(
        new CommanderError(0, "commander.helpDisplayed", "(outputHelp)")
      )
    ).toBe(true);
  });
});
