import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils/config.js';
import { getTools } from '../utils/binaries.js';
import { runCommand } from '../utils/process.js';
import { classifyLinkPlatform, getYouTubeUrlVariants } from './linkClassifier.js';
import { subtitleFileToPlainText } from './subtitleParser.js';
import {
  buildYouTubeBotCheckResult,
  isYouTubeBotError,
  YOUTUBE_BOT_CHECK_CODE,
} from './youtubeBotError.js';

export const NO_ACCESSIBLE_TEXT_MESSAGE =
  'Não foi encontrada legenda/transcrição acessível para este link. No modo gratuito por link, o app só consegue extrair textos já disponíveis na plataforma.';

const PREFERRED_SUBTITLE_LANGS = [
  'pt-br',
  'pt',
  'pt-pt',
  'por',
  'en',
  'en-us',
  'en-gb',
  'es',
  'es-es',
];

export async function extractLinkText(inputUrl, jobDir) {
  const link = classifyLinkPlatform(inputUrl);

  if (link.platform === 'unsupported') {
    return buildResult({
      success: false,
      platform: link.platform,
      sourceType: 'none',
      text: '',
      message: 'Plataforma nao suportada no modo gratuito. Use links do YouTube, Instagram, TikTok ou Facebook.',
    });
  }

  if (link.platform === 'youtube') {
    return extractYouTubeText(inputUrl, jobDir);
  }

  return extractMetadataPlatformText(link.platform, link.url, jobDir);
}

async function extractYouTubeText(inputUrl, jobDir) {
  const variants = getYouTubeUrlVariants(inputUrl);
  let lastBotResult = null;
  let lastNoTextResult = null;

  for (const variantUrl of variants) {
    console.log('[extract] tentando URL YouTube:', variantUrl);

    try {
      const result = await extractYouTubeTextForUrl(variantUrl, jobDir);

      if (result.success) {
        return result;
      }

      if (result.code === YOUTUBE_BOT_CHECK_CODE) {
        lastBotResult = result;
        continue;
      }

      lastNoTextResult = result;
    } catch (error) {
      if (isYouTubeBotError(error)) {
        console.warn('[extract] YouTube bot check:', variantUrl);
        lastBotResult = buildResult(buildYouTubeBotCheckResult('youtube'));
        continue;
      }

      throw error;
    }
  }

  if (lastBotResult) {
    console.warn('[extract] todas as variantes de URL bloqueadas pelo YouTube (bot check)');
    return lastBotResult;
  }

  return (
    lastNoTextResult ??
    buildResult({
      success: false,
      platform: 'youtube',
      sourceType: 'none',
      text: '',
      message: NO_ACCESSIBLE_TEXT_MESSAGE,
    })
  );
}

async function extractYouTubeTextForUrl(url, jobDir) {
  const metadata = await fetchVideoMetadata(url);
  logMetadataSummary('youtube', metadata);

  const subtitleAttempt = await tryDownloadSubtitle(url, jobDir, metadata);
  if (subtitleAttempt?.text) {
    return buildResult({
      success: true,
      platform: 'youtube',
      sourceType: subtitleAttempt.sourceType,
      text: subtitleAttempt.text,
      message: `Texto obtido de ${describeSourceType(subtitleAttempt.sourceType)} (${subtitleAttempt.language}).`,
      log: buildExtractionLog(metadata, subtitleAttempt),
    });
  }

  const metadataText = pickMetadataText(metadata);
  if (metadataText) {
    return buildResult({
      success: true,
      platform: 'youtube',
      sourceType: 'metadata',
      text: metadataText,
      message: 'Texto obtido da descricao ou metadados do video.',
      log: buildExtractionLog(metadata),
    });
  }

  return buildResult({
    success: false,
    platform: 'youtube',
    sourceType: 'none',
    text: '',
    message: NO_ACCESSIBLE_TEXT_MESSAGE,
    log: buildExtractionLog(metadata),
  });
}

async function extractMetadataPlatformText(platform, url, jobDir) {
  let metadata;

  try {
    metadata = await fetchVideoMetadata(url);
  } catch (error) {
    if (isYouTubeBotError(error)) {
      return buildResult(buildYouTubeBotCheckResult(platform));
    }

    throw error;
  }

  logMetadataSummary(platform, metadata);

  const subtitleAttempt = await tryDownloadSubtitle(url, jobDir, metadata);
  if (subtitleAttempt?.text) {
    return buildResult({
      success: true,
      platform,
      sourceType: subtitleAttempt.sourceType,
      text: subtitleAttempt.text,
      message: `Texto obtido de ${describeSourceType(subtitleAttempt.sourceType)} (${subtitleAttempt.language}).`,
      log: buildExtractionLog(metadata, subtitleAttempt),
    });
  }

  const captionText = pickCaptionText(metadata);
  if (captionText) {
    return buildResult({
      success: true,
      platform,
      sourceType: 'caption',
      text: captionText,
      message: 'Texto obtido da legenda/caption disponivel na plataforma.',
      log: buildExtractionLog(metadata),
    });
  }

  const metadataText = pickMetadataText(metadata);
  if (metadataText) {
    return buildResult({
      success: true,
      platform,
      sourceType: 'metadata',
      text: metadataText,
      message: 'Texto obtido de descricao ou metadados do link.',
      log: buildExtractionLog(metadata),
    });
  }

  const platformLabel = platform === 'instagram' ? 'Instagram' : platform;

  return buildResult({
    success: false,
    platform,
    sourceType: 'none',
    text: '',
    message:
      platform === 'instagram'
        ? `${NO_ACCESSIBLE_TEXT_MESSAGE} No ${platformLabel}, muitas publicacoes so expõem caption curta ou nada acessivel via link.`
        : NO_ACCESSIBLE_TEXT_MESSAGE,
    log: buildExtractionLog(metadata),
  });
}

function ytDlpBaseArgs() {
  const args = ['--no-warnings'];

  if (!config.debugYtDlp) {
    args.push('--quiet', '--no-progress');
  }

  return args;
}

function ytDlpCommandOptions(logPrefix, strategy) {
  return {
    logPrefix,
    strategy,
    quiet: !config.debugYtDlp,
  };
}

function logMetadataSummary(platform, metadata) {
  const title = metadata?.title ? String(metadata.title).trim() : '';

  console.log('[extract] metadados', {
    platform,
    title: title || '(sem titulo)',
  });
}

function buildExtractionLog(metadata, subtitleAttempt) {
  const log = {
    title: metadata?.title ? String(metadata.title).trim() : '',
    subtitleLanguage: subtitleAttempt?.language ?? '',
    sourceType: subtitleAttempt?.sourceType ?? '',
  };

  if (config.debugYtDlp && subtitleAttempt?.subtitleFilePath) {
    log.subtitleFilePath = subtitleAttempt.subtitleFilePath;
  }

  return log;
}

async function fetchVideoMetadata(url) {
  const tools = await getTools();

  try {
    const { stdout } = await runCommand(
      tools.ytDlp,
      [...ytDlpBaseArgs(), '--dump-single-json', '--no-download', url],
      ytDlpCommandOptions('yt-dlp-meta', 'metadados do link'),
    );

    const trimmed = stdout.trim();
    const jsonStart = trimmed.indexOf('{');
    const jsonPayload = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

    return JSON.parse(jsonPayload);
  } catch (error) {
    if (isYouTubeBotError(error)) {
      throw error;
    }

    throw error;
  }
}

async function tryDownloadSubtitle(url, jobDir, metadata) {
  const manualTracks = metadata.subtitles ?? {};
  const autoTracks = metadata.automatic_captions ?? {};
  const candidates = [];

  for (const [language, formats] of Object.entries(manualTracks)) {
    if (hasTextualSubtitleFormat(formats)) {
      candidates.push({ language, sourceType: 'subtitle', kind: 'manual' });
    }
  }

  for (const [language, formats] of Object.entries(autoTracks)) {
    if (hasTextualSubtitleFormat(formats)) {
      candidates.push({ language, sourceType: 'auto-caption', kind: 'auto' });
    }
  }

  const ordered = orderSubtitleCandidates(candidates);
  if (ordered.length === 0) {
    return null;
  }

  const tools = await getTools();

  for (const candidate of ordered) {
    const subDir = path.join(jobDir, `subs-${candidate.language}-${candidate.kind}`);
    await fs.mkdir(subDir, { recursive: true });

    const args = [
      ...ytDlpBaseArgs(),
      '--skip-download',
      candidate.kind === 'manual' ? '--write-subs' : '--write-auto-subs',
      '--sub-langs',
      candidate.language,
      '--sub-format',
      'vtt/best',
      '-o',
      path.join(subDir, 'track.%(ext)s'),
      url,
    ];

    try {
      await runCommand(
        tools.ytDlp,
        args,
        ytDlpCommandOptions('yt-dlp-sub', `legenda ${candidate.language} (${candidate.kind})`),
      );
    } catch (error) {
      if (isYouTubeBotError(error)) {
        throw error;
      }

      continue;
    }

    const files = await fs.readdir(subDir);
    const subtitleFile = files.find((file) => /\.(vtt|srt)$/i.test(file));

    if (!subtitleFile) {
      continue;
    }

    const subtitleFilePath = path.join(subDir, subtitleFile);
    const content = await fs.readFile(subtitleFilePath, 'utf8');
    const text = subtitleFileToPlainText(content);

    if (text) {
      console.log('[extract] legenda escolhida', {
        language: candidate.language,
        sourceType: candidate.sourceType,
        ...(config.debugYtDlp ? { subtitleFilePath } : {}),
      });

      return {
        language: candidate.language,
        sourceType: candidate.sourceType,
        text,
        subtitleFilePath,
      };
    }
  }

  return null;
}

function orderSubtitleCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const leftScore = languageScore(left.language) + (left.sourceType === 'subtitle' ? 0 : 10);
    const rightScore = languageScore(right.language) + (right.sourceType === 'subtitle' ? 0 : 10);
    return leftScore - rightScore;
  });
}

function languageScore(language) {
  const normalized = language.toLowerCase();
  const exactIndex = PREFERRED_SUBTITLE_LANGS.indexOf(normalized);

  if (exactIndex >= 0) {
    return exactIndex;
  }

  const prefixMatch = PREFERRED_SUBTITLE_LANGS.findIndex((preferred) => normalized.startsWith(`${preferred}-`));
  if (prefixMatch >= 0) {
    return prefixMatch + 0.5;
  }

  return 100 + normalized.length;
}

function hasTextualSubtitleFormat(formats) {
  return Array.isArray(formats) && formats.some((format) => /vtt|srt/i.test(format.ext ?? ''));
}

function pickCaptionText(metadata) {
  const fields = [metadata.description, metadata.track, metadata.caption];
  return firstNonEmpty(fields);
}

function pickMetadataText(metadata) {
  const parts = [
    metadata.title,
    metadata.description,
    metadata.channel,
    metadata.uploader,
    metadata.alt_title,
  ].filter(Boolean);

  const unique = [...new Set(parts.map((part) => String(part).trim()).filter(Boolean))];
  return unique.join('\n\n').trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function describeSourceType(sourceType) {
  switch (sourceType) {
    case 'subtitle':
      return 'legenda manual';
    case 'auto-caption':
      return 'legenda automatica';
    case 'caption':
      return 'caption';
    case 'metadata':
      return 'metadados';
    default:
      return 'texto';
  }
}

function buildResult(payload) {
  const result = {
    success: Boolean(payload.success),
    platform: payload.platform,
    sourceType: payload.sourceType,
    text: payload.text ?? '',
    message: payload.message,
  };

  if (payload.code) {
    result.code = payload.code;
  }

  if (payload.log) {
    result.log = payload.log;
  }

  return result;
}
