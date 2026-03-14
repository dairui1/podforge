import { describe, expect, test } from "vitest";

import {
  extractEpisodePayload,
  extractNextData,
  extractOgAudioUrl,
  resolveXiaoyuzhouEpisodeFromHtml,
} from "../src/sources/xiaoyuzhou";

const episodeJson = {
  props: {
    pageProps: {
      episode: {
        id: "69b4d2f9f8b8079bfa3ae7f2",
        eid: "69b4d2f9f8b8079bfa3ae7f2",
        title: "OpenClaw 之后，我只想未来 3-6 个月的事情｜对谈 Sheet0 创始人王文锋",
        enclosure: {
          url: "https://media.xyzcdn.net/example/audio.m4a",
        },
        podcast: {
          title: "42章经",
        },
      },
    },
  },
};

const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta property="og:audio" content="https://media.xyzcdn.net/example/fallback.m4a" />
  </head>
  <body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(episodeJson)}</script>
  </body>
</html>
`;

describe("xiaoyuzhou source resolver", () => {
  test("extracts NEXT_DATA from HTML", () => {
    const nextData = extractNextData(html);

    expect(nextData).toEqual(episodeJson);
  });

  test("extracts episode payload from NEXT_DATA", () => {
    const episode = extractEpisodePayload(episodeJson);

    expect(episode.id).toBe("69b4d2f9f8b8079bfa3ae7f2");
    expect(episode.enclosure?.url).toBe("https://media.xyzcdn.net/example/audio.m4a");
  });

  test("resolves canonical episode metadata from HTML", () => {
    const resolved = resolveXiaoyuzhouEpisodeFromHtml(
      "https://www.xiaoyuzhoufm.com/episode/69b4d2f9f8b8079bfa3ae7f2",
      html
    );

    expect(resolved.source).toBe("xiaoyuzhou");
    expect(resolved.episodeId).toBe("69b4d2f9f8b8079bfa3ae7f2");
    expect(resolved.audioUrl).toBe("https://media.xyzcdn.net/example/audio.m4a");
    expect(resolved.suggestedBaseName).toBe("xiaoyuzhou-69b4d2f9f8b8079bfa3ae7f2");
    expect(resolved.title).toContain("OpenClaw");
  });

  test("falls back to og:audio when episode enclosure is missing", () => {
    const fallbackHtml = `
      <html>
        <head>
          <meta property="og:audio" content="https://media.xyzcdn.net/example/from-og.m4a" />
        </head>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            ${JSON.stringify({
              props: {
                pageProps: {
                  episode: {
                    id: "episode-id",
                    title: "Fallback",
                  },
                },
              },
            })}
          </script>
        </body>
      </html>
    `;

    expect(extractOgAudioUrl(fallbackHtml)).toBe("https://media.xyzcdn.net/example/from-og.m4a");
    expect(
      resolveXiaoyuzhouEpisodeFromHtml(
        "https://www.xiaoyuzhoufm.com/episode/episode-id",
        fallbackHtml
      ).audioUrl
    ).toBe("https://media.xyzcdn.net/example/from-og.m4a");
  });
});
