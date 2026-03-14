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
    | "session.started"
    | "resolve.started"
    | "resolve.completed"
    | "download.started"
    | "download.completed"
    | "chunking.started"
    | "chunking.completed"
    | "chunk.started"
    | "transcribe.started"
    | "transcribe.completed"
    | "transcript.partial"
    | "chunk.completed"
    | "write.completed"
    | "cleanup.completed"
    | "cleanup.skipped";
  message: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}
