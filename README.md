# podcast-helper

[简体中文](./README.zh-CN.md)

`podcast-helper` is a Node-based CLI for podcast download and transcription workflows.

The project currently focuses on one concrete workflow:

- Resolve a Xiaoyuzhou episode URL
- Download the original audio
- Transcribe with ElevenLabs
- Generate `audio + SRT + TXT` artifacts

## Status

This project is early but functional.

Current scope:

- Source: Xiaoyuzhou episode URLs
- Transcription backend: ElevenLabs Speech to Text
- Outputs: original audio, `.srt`, `.txt`
- Toolchain: `pnpm + biome + vitest + tsup`

Planned next:

- More podcast source adapters
- Better subtitle segmentation and transcript cleanup
- Local STT backends
- npm publishing

## Requirements

- Node.js 20+
- pnpm 10+
- An `ELEVENLABS_API_KEY`

## Quick Start

Install dependencies:

```bash
pnpm install
```

Run the CLI from source:

```bash
export ELEVENLABS_API_KEY=your_key
pnpm run dev -- transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/example --json
```

Build the distributable CLI:

```bash
pnpm run build
node dist/cli.js --help
```

## Usage

Transcribe a Xiaoyuzhou episode:

```bash
export ELEVENLABS_API_KEY=your_key
node dist/cli.js transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/episode --json
```

Example output:

```json
{
  "input": "https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2",
  "source": "xiaoyuzhou",
  "episodeId": "69b4d2f9f8b8079bfa3ae7f2",
  "language": "zho",
  "artifacts": {
    "audio": "/abs/path/xiaoyuzhou-69b4d2f9f8b8079bfa3ae7f2.m4a",
    "srt": "/abs/path/xiaoyuzhou-69b4d2f9f8b8079bfa3ae7f2.srt",
    "txt": "/abs/path/xiaoyuzhou-69b4d2f9f8b8079bfa3ae7f2.txt"
  }
}
```

## Agent Skill

This repository also ships an agent skill for the `transcribe` workflow.

Install the skill into the current project:

```bash
npx skills add dairui1/podcast-helper --skill transcribe
```

Install globally:

```bash
npx skills add dairui1/podcast-helper --skill transcribe -g
```

The skill lives at [skills/transcribe/SKILL.md](./skills/transcribe/SKILL.md) and teaches agents to prefer:

```bash
podcast-helper transcribe <input> --output-dir <dir> --json
```

For low-cost live verification, the skill recommends:

```bash
https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3
```

## Development

Run the project checks:

```bash
pnpm run check
```

Run formatting:

```bash
pnpm run format
```

Run live transcription tests:

```bash
export ELEVENLABS_API_KEY=your_key
pnpm run test:live
```

## Repository Layout

```text
src/
  cli.ts
  output/
  sources/
  transcribe/
test/
```

## License

[MIT](./LICENSE)
