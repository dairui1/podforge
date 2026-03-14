export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
}

export interface WorkflowEvent {
  type:
    | "resolve.started"
    | "resolve.completed"
    | "download.started"
    | "download.completed"
    | "transcribe.started"
    | "transcribe.completed"
    | "write.completed";
  message: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}
