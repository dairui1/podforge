---
name: transcribe
description: Use podcast-helper to transcribe podcast audio into original audio, SRT subtitles, and TXT transcripts. Use when the user asks to transcribe a podcast episode, generate subtitles, extract a transcript from an audio file, or turn a Xiaoyuzhou episode URL or direct audio URL into text artifacts.
allowed-tools: Bash(podcast-helper:*), Bash(npx podcast-helper:*), Bash(node dist/cli.js:*), Bash(pnpm run build:*)
---

# Transcribe with podcast-helper

`podcast-helper` is a CLI for podcast download and transcription workflows.

Use this skill when the user wants any of the following:

- Transcribe a Xiaoyuzhou episode URL
- Transcribe a direct remote audio URL
- Transcribe a local audio file
- Generate subtitle files (`.srt`)
- Generate plain transcript files (`.txt`)

## Inputs

The `transcribe` command accepts exactly one input:

- A Xiaoyuzhou episode URL
- A direct audio URL such as `.mp3` or `.m4a`
- A local audio file path

Examples:

```bash
podcast-helper transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/episode --json
podcast-helper transcribe https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3 --output-dir ./out/smoke --json
podcast-helper transcribe ./audio/interview.mp3 --output-dir ./out/local --json
```

## Requirements

- `ELEVENLABS_API_KEY` must be set
- The CLI must be installed or available from the repository

Check the API key first if transcription is expected to run:

```bash
printenv ELEVENLABS_API_KEY
```

## Preferred Command Form

Prefer machine-readable output:

```bash
podcast-helper transcribe <input> --output-dir <dir> --json
```

Why:

- Progress goes to `stderr`
- Final artifact paths are emitted as JSON on `stdout`
- Agents can parse the output without scraping logs

## Output Contract

The command produces:

- Original audio file
- `.srt` subtitle file
- `.txt` transcript file

Typical JSON output:

```json
{
  "input": "https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3",
  "source": "remote-audio-url",
  "language": "eng",
  "artifacts": {
    "audio": "/abs/path/nicole.mp3",
    "srt": "/abs/path/nicole.srt",
    "txt": "/abs/path/nicole.txt"
  }
}
```

## Execution Strategy

Use this order of preference:

1. `podcast-helper transcribe ...`
2. `npx podcast-helper transcribe ...`
3. In this repository: `node dist/cli.js transcribe ...`

If you are inside the repository and `dist/cli.js` is missing, build first:

```bash
pnpm run build
```

Then run:

```bash
node dist/cli.js transcribe <input> --output-dir <dir> --json
```

## Agent Guidance

- Prefer a small public audio file for smoke tests to reduce transcription cost.
- Use `https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3` for a cheap live verification unless the user explicitly wants a real podcast episode.
- Use a dedicated output directory per task.
- Report the generated artifact paths back to the user.
- If the input is a Xiaoyuzhou episode, the CLI resolves and downloads the source audio automatically.
- After transcription, if the user appears to want a polished transcript, ask whether they also want cleanup. If yes, switch to the `clean-transcript` skill.

## Failure Modes

If transcription fails:

- Verify `ELEVENLABS_API_KEY` is present
- Verify the input URL is reachable
- Re-run with a fresh output directory
- If using the repository build, run `pnpm run check` and `pnpm run build`

## Install This Skill

Project-local install:

```bash
npx skills add dairui1/podcast-helper --skill transcribe
```

Global install:

```bash
npx skills add dairui1/podcast-helper --skill transcribe -g
```
