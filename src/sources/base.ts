export interface ResolvedEpisode {
  source: string;
  canonicalUrl: string;
  episodeId: string;
  title?: string;
  audioUrl: string;
  suggestedBaseName: string;
  audioExtension?: string;
}

export interface SourceAdapter {
  canResolve(input: string): boolean;
  resolve(input: string): Promise<ResolvedEpisode>;
}
