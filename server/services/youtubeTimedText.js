import { subtitleFileToPlainText } from './subtitleParser.js';

const PREFERRED_LANGS = ['pt', 'pt-BR', 'pt-PT', 'por', 'en', 'en-US', 'es'];

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

/**
 * Fallback sem yt-dlp: API publica de legendas do YouTube (timedtext).
 * Funciona em muitos casos quando datacenter IP bloqueia o yt-dlp.
 */
export async function fetchYouTubeTimedTextCaptions(videoId) {
  const tracks = await listTimedTextTracks(videoId);
  if (tracks.length === 0) {
    return null;
  }

  const ordered = orderTracks(tracks);

  for (const track of ordered) {
    const text = await downloadTimedTextTrack(videoId, track);
    if (text) {
      return {
        language: track.lang,
        sourceType: track.kind === 'asr' ? 'auto-caption' : 'subtitle',
        text,
      };
    }
  }

  return null;
}

async function listTimedTextTracks(videoId) {
  const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&type=list`;

  try {
    const response = await fetch(url, { headers: BROWSER_HEADERS });
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    return parseTrackList(xml);
  } catch {
    return [];
  }
}

function parseTrackList(xml) {
  const tracks = [];
  const trackRegex = /<track\b([^>]+)\/?>/gi;
  let match;

  while ((match = trackRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const lang = readXmlAttr(attrs, 'lang_code') || readXmlAttr(attrs, 'lang_code_original');
    if (!lang) {
      continue;
    }

    tracks.push({
      lang,
      kind: readXmlAttr(attrs, 'kind') || '',
      name: readXmlAttr(attrs, 'name') || '',
    });
  }

  if (tracks.length > 0) {
    return tracks;
  }

  // fallback: tentar idiomas preferidos mesmo sem list
  return PREFERRED_LANGS.flatMap((lang) => [
    { lang, kind: '', name: 'manual' },
    { lang, kind: 'asr', name: 'auto' },
  ]);
}

function readXmlAttr(attrString, name) {
  const match = attrString.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match?.[1] ?? '';
}

function orderTracks(tracks) {
  const unique = [];
  const seen = new Set();

  for (const preferred of PREFERRED_LANGS) {
    for (const track of tracks) {
      const key = `${track.lang}:${track.kind}`;
      if (seen.has(key)) {
        continue;
      }

      if (track.lang === preferred || track.lang.startsWith(`${preferred}-`)) {
        unique.push(track);
        seen.add(key);
      }
    }
  }

  for (const track of tracks) {
    const key = `${track.lang}:${track.kind}`;
    if (!seen.has(key)) {
      unique.push(track);
      seen.add(key);
    }
  }

  // priorizar manual antes de asr
  return unique.sort((left, right) => {
    const leftAsr = left.kind === 'asr' ? 1 : 0;
    const rightAsr = right.kind === 'asr' ? 1 : 0;
    return leftAsr - rightAsr;
  });
}

async function downloadTimedTextTrack(videoId, track) {
  const params = new URLSearchParams({
    v: videoId,
    lang: track.lang,
    fmt: 'vtt',
  });

  if (track.kind === 'asr') {
    params.set('kind', 'asr');
  }

  if (track.name) {
    params.set('name', track.name);
  }

  const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;

  try {
    const response = await fetch(url, { headers: BROWSER_HEADERS });
    if (!response.ok) {
      return '';
    }

    const vtt = await response.text();
    if (!vtt.trim()) {
      return '';
    }

    return subtitleFileToPlainText(vtt);
  } catch {
    return '';
  }
}
