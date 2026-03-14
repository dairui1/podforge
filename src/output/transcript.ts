import type { TranscriptSegment } from "../transcribe/types";

export function formatTimestamp(milliseconds: number): string {
  const clamped = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const ms = clamped % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`;
}

export function renderSrt(segments: TranscriptSegment[]): string {
  const cleaned = sanitizeSegments(segments);

  return cleaned
    .map((segment, index) => {
      return [
        String(index + 1),
        `${formatTimestamp(segment.startMs)} --> ${formatTimestamp(segment.endMs)}`,
        segment.text.trim(),
      ].join("\n");
    })
    .join("\n\n")
    .concat(cleaned.length > 0 ? "\n" : "");
}

export function renderTxt(segments: TranscriptSegment[]): string {
  const lines = sanitizeSegments(segments)
    .map((segment) => segment.text.trim())
    .filter(Boolean);

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function sanitizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => ({
      ...segment,
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(Math.round(segment.endMs), Math.round(segment.startMs)),
      text: segment.text.trim(),
    }));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}
