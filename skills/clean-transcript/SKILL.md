---
name: clean-transcript
description: Clean a podcast transcript after transcription. Use this skill when the user wants a transcript to be corrected, de-duplicated, de-fillered, or normalized using episode context. This skill is designed to work after the transcribe skill.
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(sed:*), Bash(node:*), Bash(podcast-helper:*), Bash(npx podcast-helper:*)
---

# Clean Transcript with podcast-helper Context

Use this skill after a transcript already exists.

This skill is meant to be paired with the `transcribe` skill:

1. Generate the raw transcript first
2. Ask the user whether they want the transcript cleaned
3. If yes, use this skill

## Goal

Take a raw podcast transcript and produce a cleaned version that:

- Fixes obvious homophone and ASR mistakes
- Removes repeated filler words and disfluencies when they do not carry meaning
- Preserves the speaker's intent and factual content
- Uses the episode page as external context to recover names, product names, titles, and terms

## Core Technique

Fetch the episode page through Jina Reader:

```bash
curl https://r.jina.ai/<podcast-url>
```

For example:

```bash
curl https://r.jina.ai/https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2
```

Jina Reader converts the page into LLM-friendly text. In practice, this often includes:

- Episode title
- Show description
- Shownotes
- Guest and company names
- Terms that help repair transcription mistakes

Official reference:

- Jina Reader repo: https://github.com/jina-ai/reader

The Reader README says you can convert any URL into LLM-friendly input by prefixing it with `https://r.jina.ai/`.

## Recommended Inputs

Use this skill when you have:

- The original podcast URL
- The raw transcript file, usually `.txt`

Optional but helpful:

- The `.srt` file
- The original audio file

## Cleaning Principles

Apply conservative cleanup.

Do:

- Fix names, brands, products, and terms when the episode context makes the correction clear
- Remove repetitive fillers such as `嗯`, `啊`, `然后`, `就是`, `你知道`, `I mean`, when they are clearly redundant
- Collapse repeated fragments caused by ASR restarts
- Normalize punctuation and paragraph boundaries for readability

Do not:

- Invent missing content
- Rewrite the speaker into a different tone
- Summarize instead of cleaning
- Remove meaningful hesitation when it changes the meaning

## Recommended Workflow

1. Read the raw transcript
2. Fetch the podcast page via Jina Reader
3. Use the Jina output as reference context
4. Produce a cleaned transcript
5. Keep the original transcript unchanged
6. Save the cleaned result as a sibling file

Suggested filename convention:

- Original: `episode.txt`
- Cleaned: `episode.cleaned.txt`

## Output Expectations

Return:

- Path to the original transcript
- Path to the cleaned transcript
- A short note describing the kinds of corrections made

If the episode URL is unavailable:

- Clean conservatively using transcript-only evidence
- Explicitly state that no external episode context was used

## When Used with `transcribe`

After transcription, ask:

```text
Do you want me to clean the transcript as well?
```

If the user says yes, then:

- Use the generated `.txt` as the raw input
- Use the original podcast URL with Jina Reader
- Save a new cleaned transcript instead of overwriting the raw one

## Install This Skill

Project-local install:

```bash
npx skills add dairui1/podcast-helper --skill clean-transcript
```

Global install:

```bash
npx skills add dairui1/podcast-helper --skill clean-transcript -g
```
