import type { ResolvedEpisode, SourceAdapter } from "./base";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface XiaoyuzhouEpisode {
  id?: string;
  eid?: string;
  title?: string;
  enclosure?: {
    url?: string;
  };
  media?: {
    source?: {
      url?: string;
    };
  };
}

const XIAOYUZHOU_HOST = "www.xiaoyuzhoufm.com";

export function extractNextData(html: string): unknown {
  const match = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i
  );

  if (!match?.[1]) {
    throw new Error("Could not find __NEXT_DATA__ in Xiaoyuzhou page.");
  }

  return JSON.parse(match[1]);
}

export function extractEpisodePayload(nextData: unknown): XiaoyuzhouEpisode {
  if (!isRecord(nextData)) {
    throw new Error("Unexpected Xiaoyuzhou NEXT_DATA payload.");
  }

  const pageProps = asRecord(asRecord(nextData.props)?.pageProps);
  const directEpisode = asRecord(pageProps?.episode);
  if (directEpisode) {
    return directEpisode as XiaoyuzhouEpisode;
  }

  const queries = asArray(asRecord(pageProps?.dehydratedState)?.queries);
  for (const query of queries) {
    const episode = asRecord(asRecord(asRecord(query)?.state)?.data)?.episode;
    if (isRecord(episode)) {
      return episode as XiaoyuzhouEpisode;
    }
  }

  throw new Error("Could not locate Xiaoyuzhou episode payload.");
}

export function extractOgAudioUrl(html: string): string | undefined {
  const match = html.match(/<meta[^>]*property="og:audio"[^>]*content="([^"]+)"[^>]*>/i);

  return match?.[1];
}

export function resolveXiaoyuzhouEpisodeFromHtml(inputUrl: string, html: string): ResolvedEpisode {
  const nextData = extractNextData(html);
  const episode = extractEpisodePayload(nextData);
  const audioUrl = extractAudioUrl(episode) ?? extractOgAudioUrl(html);

  if (!audioUrl) {
    throw new Error("Could not extract Xiaoyuzhou audio URL.");
  }

  const episodeId = normalizeEpisodeId(episode, inputUrl);

  return {
    source: "xiaoyuzhou",
    canonicalUrl: inputUrl,
    episodeId,
    title: episode.title,
    audioUrl,
    suggestedBaseName: `xiaoyuzhou-${episodeId}`,
    audioExtension: normalizeAudioExtension(audioUrl),
  };
}

export function createXiaoyuzhouSourceAdapter(fetchImpl: FetchLike = fetch): SourceAdapter {
  return {
    canResolve(input: string) {
      try {
        const url = new URL(input);
        return url.hostname === XIAOYUZHOU_HOST && url.pathname.startsWith("/episode/");
      } catch {
        return false;
      }
    },
    async resolve(input: string) {
      const response = await fetchImpl(input, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          Referer: "https://www.xiaoyuzhoufm.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch Xiaoyuzhou page: ${response.status} ${response.statusText}`
        );
      }

      const html = await response.text();
      return resolveXiaoyuzhouEpisodeFromHtml(input, html);
    },
  };
}

function extractAudioUrl(episode: XiaoyuzhouEpisode): string | undefined {
  if (episode.enclosure?.url) {
    return episode.enclosure.url;
  }

  if (episode.media?.source?.url) {
    return episode.media.source.url;
  }

  return undefined;
}

function normalizeEpisodeId(episode: XiaoyuzhouEpisode, inputUrl: string): string {
  if (episode.eid?.trim()) {
    return episode.eid.trim();
  }

  if (episode.id?.trim()) {
    return episode.id.trim();
  }

  const match = inputUrl.match(/\/episode\/([A-Za-z0-9]+)/);
  if (!match?.[1]) {
    throw new Error("Could not derive Xiaoyuzhou episode id.");
  }

  return match[1];
}

function normalizeAudioExtension(audioUrl: string): string | undefined {
  try {
    const pathname = new URL(audioUrl).pathname;
    const match = pathname.match(/(\.[A-Za-z0-9]+)$/);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
