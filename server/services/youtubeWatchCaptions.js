import { subtitleFileToPlainText } from './subtitleParser.js';
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TRACK_ATTEMPTS = 6;
const PREFERRED_LANGS = ['pt', 'pt-BR', 'pt-PT', 'por', 'en', 'en-US', 'es'];

export const WATCH_PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * Legendas a partir do HTML da pagina (ytInitialPlayerResponse), sem yt-dlp.
 */
export async function fetchYouTubeWatchPageCaptions(videoId) {
  const pageUrls = [
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
  ];

  for (const pageUrl of pageUrls) {
    const tracks = await loadCaptionTracksFromPage(pageUrl);
    const result = await downloadBestCaptionTrack(tracks);

    if (result) {
      return result;
    }
  }

  return null;
}

async function loadCaptionTracksFromPage(pageUrl) {
  try {
    const response = await fetchWithTimeout(pageUrl, { headers: WATCH_PAGE_HEADERS }, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const player = extractYtInitialPlayerResponse(html);

    if (!player) {
      return [];
    }

    return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  } catch {
    return [];
  }
}

export function extractYtInitialPlayerResponse(html) {
  const markers = ['ytInitialPlayerResponse = ', 'var ytInitialPlayerResponse = '];

  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index === -1) {
      continue;
    }

    const parsed = parseJsonObjectFrom(html, index + marker.length);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function parseJsonObjectFrom(text, startIndex) {
  const start = text.indexOf('{', startIndex);
  if (start === -1) {
    return null;
  }

  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

async function downloadBestCaptionTrack(tracks) {
  const ordered = orderCaptionTracks(tracks).slice(0, MAX_TRACK_ATTEMPTS);

  for (const track of ordered) {
    const text = await downloadCaptionTrackUrl(track.baseUrl);
    if (text) {
      return {
        language: track.languageCode,
        sourceType: track.kind === 'asr' ? 'auto-caption' : 'subtitle',
        text,
      };
    }
  }

  return null;
}

function orderCaptionTracks(tracks) {
  const normalized = tracks
    .filter((track) => typeof track?.baseUrl === 'string' && track.baseUrl.length > 0)
    .map((track) => ({
      languageCode: track.languageCode ?? '',
      kind: track.kind ?? '',
      baseUrl: track.baseUrl,
    }));

  const unique = [];
  const seen = new Set();

  for (const preferred of PREFERRED_LANGS) {
    for (const track of normalized) {
      const key = `${track.languageCode}:${track.kind}`;
      if (seen.has(key)) {
        continue;
      }

      if (track.languageCode === preferred || track.languageCode.startsWith(`${preferred}-`)) {
        unique.push(track);
        seen.add(key);
      }
    }
  }

  for (const track of normalized) {
    const key = `${track.languageCode}:${track.kind}`;
    if (!seen.has(key)) {
      unique.push(track);
      seen.add(key);
    }
  }

  return unique.sort((left, right) => {
    const leftAsr = left.kind === 'asr' ? 1 : 0;
    const rightAsr = right.kind === 'asr' ? 1 : 0;
    return leftAsr - rightAsr;
  });
}

const CAPTION_DOWNLOAD_HEADERS = {
  ...WATCH_PAGE_HEADERS,
  Referer: 'https://www.youtube.com/',
  Origin: 'https://www.youtube.com',
};

async function downloadCaptionTrackUrl(baseUrl) {
  const formats = [
    baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=vtt`,
    `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`,
  ];

  for (const url of formats) {
    const text = await downloadCaptionBody(url);
    if (text) {
      return text;
    }
  }

  return '';
}

async function downloadCaptionBody(url) {
  try {
    const response = await fetchWithTimeout(url, { headers: CAPTION_DOWNLOAD_HEADERS }, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return '';
    }

    const body = await response.text();
    if (!body.trim()) {
      return '';
    }

    if (body.trimStart().startsWith('{')) {
      return parseJson3Captions(body);
    }

    return subtitleFileToPlainText(body);
  } catch {
    return '';
  }
}

function parseJson3Captions(raw) {
  try {
    const data = JSON.parse(raw);
    const lines = (data.events ?? [])
      .filter((event) => event.segs)
      .map((event) => event.segs.map((segment) => segment.utf8 ?? '').join(''))
      .map((line) => line.trim())
      .filter(Boolean);

    return [...new Set(lines)].join('\n').trim();
  } catch {
    return '';
  }
}

/**
 * Titulo e descricao do video (sem legendas), util quando yt-dlp e timedtext falham.
 */
export async function fetchYouTubeWatchPageMetadata(videoId) {
  const pageUrls = [
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
  ];

  for (const pageUrl of pageUrls) {
    try {
      const response = await fetchWithTimeout(pageUrl, { headers: WATCH_PAGE_HEADERS }, FETCH_TIMEOUT_MS);

      if (!response.ok) {
        continue;
      }

      const player = extractYtInitialPlayerResponse(await response.text());
      const details = player?.videoDetails;

      if (!details) {
        continue;
      }

      const parts = [details.title, details.shortDescription]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean);

      const text = [...new Set(parts)].join('\n\n').trim();

      if (text) {
        return {
          language: '',
          sourceType: 'metadata',
          text,
          title: String(details.title ?? '').trim(),
        };
      }
    } catch {
      // tenta proxima URL
    }
  }

  return null;
}
