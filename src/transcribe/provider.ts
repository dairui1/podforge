import type { TranscriptResult, WorkflowEvent } from "./types";

export interface SttProvider {
  name: string;
  transcribe(input: {
    audioPath: string;
    onEvent?: (event: WorkflowEvent) => void;
  }): Promise<TranscriptResult>;
}
