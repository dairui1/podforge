# podcast-helper

[English](./README.md)

`podcast-helper` 是一个面向播客下载和转录流程的 Node CLI 工具。

当前项目先聚焦一个明确可用的场景：

- 解析小宇宙单集链接
- 接受直接音频 URL
- 接受本地音频文件
- 下载原始音频
- 使用 ElevenLabs 或本地 `mlx-whisper` 进行转录
- 产出 `音频 + SRT + TXT`

## 当前状态

项目目前还处在早期阶段，但核心链路已经可用。

当前支持：

- 来源：小宇宙单集链接、直接音频 URL、本地音频文件
- 转录后端：ElevenLabs Speech to Text、Apple Silicon 上的本地 `mlx-whisper`
- 输出：原始音频、`.srt`、`.txt`
- 工具链：`pnpm + biome + vitest + tsup`

接下来计划：

- 支持更多播客站点
- 优化字幕分段和文本清洗
- 增加本地 STT 后端
- 发布 npm 包

## 环境要求

- Node.js 20+
- 如果使用 ElevenLabs，需要可用的 `ELEVENLABS_API_KEY`
- 如果使用本地 Apple Silicon 转录，需要 `ffmpeg` 和 `python3 -m pip install mlx-whisper`

## 用户快速开始

不做全局安装，直接运行：

```bash
npx podcast-helper --help
pnpm dlx podcast-helper --help
```

转录播客单集或音频文件：

```bash
export ELEVENLABS_API_KEY=你的_key
npx podcast-helper transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/episode --json
```

低成本 smoke test：

```bash
export ELEVENLABS_API_KEY=你的_key
pnpm dlx podcast-helper transcribe https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3 --output-dir ./out/smoke --json
```

Apple Silicon 本地转录，使用 `mlx-whisper`：

```bash
brew install ffmpeg
python3 -m pip install mlx-whisper
npx podcast-helper transcribe https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3 --engine mlx-whisper --output-dir ./out/mlx --json
```

本地分块转录，并输出流式进度：

```bash
npx podcast-helper transcribe https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3 --engine mlx-whisper --chunk-duration 300 --progress jsonl --output-dir ./out/mlx --json
```

如果希望长期可用，也可以全局安装：

```bash
npm install -g podcast-helper
podcast-helper --help
```

## 开发环境要求

- Node.js 20+
- pnpm 10+

## 开发快速开始

安装依赖：

```bash
pnpm install
```

直接从源码运行：

```bash
export ELEVENLABS_API_KEY=你的_key
pnpm run dev -- transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/example --json
```

构建可分发 CLI：

```bash
pnpm run build
node dist/cli.js --help
```

## 使用示例

转录一个小宇宙单集：

```bash
export ELEVENLABS_API_KEY=你的_key
npx podcast-helper transcribe https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2 --output-dir ./out/episode --json
```

转录一个直接音频 URL：

```bash
export ELEVENLABS_API_KEY=你的_key
pnpm dlx podcast-helper transcribe https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3 --output-dir ./out/smoke --json
```

转录一个本地音频文件：

```bash
export ELEVENLABS_API_KEY=你的_key
podcast-helper transcribe ./audio/interview.mp3 --output-dir ./out/local --json
```

在 Apple Silicon 上使用 `mlx-whisper` 做本地转录：

```bash
python3 -m pip install mlx-whisper
podcast-helper transcribe ./audio/interview.mp3 --engine mlx-whisper --output-dir ./out/local-mlx --json
```

如果要保留独立的临时工作目录用于调试：

```bash
podcast-helper transcribe ./audio/interview.mp3 --engine mlx-whisper --keep-temp --output-dir ./out/local-mlx --json
```

示例输出：

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

这个仓库现在提供一个完整的 agent skill，覆盖整条 transcript 工作流：

- 转录播客音频
- 生成 `音频 + SRT + TXT`
- 在需要时结合 Jina Reader 做 transcript 清洗

安装 skill：

```bash
npx skills add dairui1/podcast-helper --skill transcribe
```

全局安装：

```bash
npx skills add dairui1/podcast-helper --skill transcribe -g
```

skill 文件在：

- [skills/transcribe/SKILL.md](./skills/transcribe/SKILL.md)

这个 skill 会引导 agent 优先使用免安装入口：

```bash
npx podcast-helper transcribe <input> --output-dir <dir> --json
pnpm dlx podcast-helper transcribe <input> --output-dir <dir> --json
```

对于本地 Apple Silicon 转录，这条工作流现在默认包含：

- 每次请求一个独立的临时目录
- `mlx-whisper` 默认按 `300` 秒分块
- `stderr` 持续输出 chunk 级别进度和 partial transcript
- 完成后自动清理，除非显式传 `--keep-temp`

如果只是做低成本真实验证，skill 里推荐优先使用：

```bash
https://storage.googleapis.com/eleven-public-cdn/audio/marketing/nicole.mp3
```

在转录完成后，同一个 skill 会引导 agent 询问用户是否还要清洗 transcript。如果用户同意，就会通过 Jina Reader：

```bash
https://r.jina.ai/<播客url>
```

抓取节目页面内容作为外部上下文，帮助修正常见的同音错别字、专有名词识别错误，以及冗余语气词，并生成一个并列的 cleaned transcript 文件，不覆盖原始文本。

## 开发

运行项目检查：

```bash
pnpm run check
```

运行格式化：

```bash
pnpm run format
```

运行真实转录测试：

```bash
export ELEVENLABS_API_KEY=你的_key
pnpm run test:live
```

运行本地 `mlx-whisper` live test：

```bash
export MLX_WHISPER_PYTHON="$(which python3)"
pnpm run test:live
```

## 仓库结构

```text
src/
  cli.ts
  output/
  sources/
  transcribe/
test/
```

## 许可证

[MIT](./LICENSE)
