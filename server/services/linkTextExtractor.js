import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils/config.js';
import { getTools } from '../utils/binaries.js';
import { runCommand } from '../utils/process.js';
import { classifyLinkPlatform, extractYouTubeVideoId, getYouTubeUrlVariants } from './linkClassifier.js';
import { subtitleFileToPlainText } from './subtitleParser.js';
import { getYouTubeExtractStrategies } from './youtubeExtractStrategies.js';
import { initYtDlpCookies } from '../utils/ytDlpCookies.js';
import { fetchYouTubeCaptionsWithoutYtDlp } from './youtubeCaptionFallback.js';
import { getYtDlpCookiesPath } from '../utils/ytDlpCookies.js';
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

const EXTRACTION_DEADLINE_MS = 75_000;
const MAX_SUBTITLE_DOWNLOAD_ATTEMPTS = 4;

function isPastDeadline(deadline) {
  return Date.now() > deadline;
}

async function extractYouTubeText(inputUrl, jobDir) {
  await initYtDlpCookies();
  const deadline = Date.now() + EXTRACTION_DEADLINE_MS;

  let videoId;
  try {
    videoId = extractYouTubeVideoId(inputUrl);
  } catch {
    videoId = null;
  }

  if (videoId && !isPastDeadline(deadline)) {
    const captionResult = await tryCaptionOnlyExtraction(videoId);
    if (captionResult) {
      return captionResult;
    }
  }

  const hasCookies = Boolean(getYtDlpCookiesPath());
  const skipYtDlpOnRender = process.env.RENDER === 'true' && !hasCookies;

  const variants = getYouTubeUrlVariants(inputUrl);
  const strategies = getYouTubeExtractStrategies();
  let lastBotResult = null;
  let lastNoTextResult = null;

  if (skipYtDlpOnRender) {
    console.log('[extract] Render sem cookies: usando apenas legendas da pagina/API');
  }

  for (const variantUrl of variants) {
    if (skipYtDlpOnRender) {
      break;
    }
    if (Date.now() > deadline) {
      console.warn('[extract] prazo de extracao esgotado');
      break;
    }

    let variantBlocked = false;

    for (const strategy of strategies) {
      if (Date.now() > deadline) {
        break;
      }

      console.log('[extract] YouTube:', { url: variantUrl, strategy: strategy.id });

      try {
        const result = await extractYouTubeTextForUrl(variantUrl, jobDir, strategy, deadline);

        if (result.success) {
          console.log('[extract] sucesso via yt-dlp', strategy.id);
          return result;
        }

        if (result.code === YOUTUBE_BOT_CHECK_CODE) {
          variantBlocked = true;
          lastBotResult = result;
          continue;
        }

        lastNoTextResult = result;
        break;
      } catch (error) {
        if (isYouTubeBotError(error)) {
          variantBlocked = true;
          console.warn('[extract] bot check:', { url: variantUrl, strategy: strategy.id });
          lastBotResult = buildResult(buildYouTubeBotCheckResult('youtube'));
          continue;
        }

        throw error;
      }
    }

    if (!variantBlocked && lastNoTextResult) {
      break;
    }
  }

  if (videoId && !isPastDeadline(deadline)) {
    const captionRetry = await tryCaptionOnlyExtraction(videoId);
    if (captionRetry) {
      return captionRetry;
    }
  }

  if (lastBotResult || skipYtDlpOnRender) {
    console.warn('[extract] legendas sem yt-dlp indisponiveis', {
      botBlocked: Boolean(lastBotResult),
      skipYtDlpOnRender,
    });

    if (skipYtDlpOnRender && !lastBotResult) {
      return buildResult(buildYouTubeBotCheckResult('youtube'));
    }

    if (lastBotResult) {
      return lastBotResult;
    }
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

async function tryCaptionOnlyExtraction(videoId) {
  try {
    console.log('[extract] tentando legendas sem yt-dlp:', videoId);
    const captions = await fetchYouTubeCaptionsWithoutYtDlp(videoId);

    if (captions?.text) {
      console.log('[extract] sucesso via', captions.method, { language: captions.language });
      const viaLabel =
        captions.method === 'watch-page'
          ? 'pagina do video'
          : captions.method === 'timedtext'
            ? 'API de legendas'
            : 'descricao do video';

      const message =
        captions.method === 'watch-metadata'
          ? 'Nao foi possivel baixar legendas neste servidor; extraimos titulo e descricao do video.'
          : `Texto obtido de ${describeSourceType(captions.sourceType)}${captions.language ? ` (${captions.language})` : ''} via ${viaLabel}.`;

      return buildResult({
        success: true,
        platform: 'youtube',
        sourceType: captions.sourceType,
        text: captions.text,
        message,
        log: {
          title: captions.title ?? '',
          subtitleLanguage: captions.language,
          sourceType: captions.sourceType,
        },
      });
    }
  } catch (error) {
    console.warn('[extract] legendas sem yt-dlp falharam:', error instanceof Error ? error.message : error);
  }

  return null;
}

async function extractYouTubeTextForUrl(url, jobDir, strategy, deadline) {
  if (isPastDeadline(deadline)) {
    return buildResult({
      success: false,
      platform: 'youtube',
      sourceType: 'none',
      text: '',
      message: NO_ACCESSIBLE_TEXT_MESSAGE,
    });
  }

  let metadata;

  try {
    metadata = await fetchVideoMetadata(url, strategy, deadline);
  } catch (error) {
    if (isYouTubeBotError(error)) {
      return buildResult(buildYouTubeBotCheckResult('youtube'));
    }

    throw error;
  }

  logMetadataSummary('youtube', metadata);

  const subtitleAttempt = await tryDownloadSubtitle(url, jobDir, metadata, strategy, deadline);
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
  await initYtDlpCookies();
  const deadline = Date.now() + EXTRACTION_DEADLINE_MS;
  const strategy = getYouTubeExtractStrategies()[0];
  let metadata;

  try {
    metadata = await fetchVideoMetadata(url, strategy, deadline);
  } catch (error) {
    if (isYouTubeBotError(error)) {
      return buildResult(buildYouTubeBotCheckResult(platform));
    }

    throw error;
  }

  logMetadataSummary(platform, metadata);

  const subtitleAttempt = await tryDownloadSubtitle(url, jobDir, metadata, strategy, deadline);
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

function ytDlpBaseArgs(strategy) {
  const args = ['--no-warnings'];

  if (!config.debugYtDlp) {
    args.push('--quiet', '--no-progress');
  }

  if (strategy?.extraArgs?.length) {
    args.push(...strategy.extraArgs);
  }

  return args;
}

function ytDlpCommandOptions(logPrefix, strategy, deadline) {
  const remainingMs = deadline ? Math.max(8_000, deadline - Date.now()) : null;
  const defaultTimeout = config.debugYtDlp ? 120_000 : 28_000;
  const timeoutMs =
    remainingMs != null ? Math.min(defaultTimeout, remainingMs) : defaultTimeout;

  return {
    logPrefix,
    strategy: strategy?.label ?? strategy?.id ?? 'padrao',
    quiet: !config.debugYtDlp,
    timeoutMs,
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

async function fetchVideoMetadata(url, strategy, deadline) {
  if (isPastDeadline(deadline)) {
    throw new Error('Prazo de extracao esgotado ao buscar metadados.');
  }

  const tools = await getTools();

  const { stdout } = await runCommand(
    tools.ytDlp,
    [...ytDlpBaseArgs(strategy), '--dump-single-json', '--no-download', url],
    ytDlpCommandOptions('yt-dlp-meta', strategy, deadline),
  );

  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonPayload = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

  return JSON.parse(jsonPayload);
}

async function tryDownloadSubtitle(url, jobDir, metadata, strategy, deadline) {
  if (isPastDeadline(deadline)) {
    return null;
  }

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

  const ordered = orderSubtitleCandidates(candidates).slice(0, MAX_SUBTITLE_DOWNLOAD_ATTEMPTS);
  if (ordered.length === 0) {
    return null;
  }

  const tools = await getTools();

  for (const candidate of ordered) {
    if (isPastDeadline(deadline)) {
      return null;
    }
    const subDir = path.join(jobDir, `subs-${candidate.language}-${candidate.kind}-${strategy.id}`);
    await fs.mkdir(subDir, { recursive: true });

    const args = [
      ...ytDlpBaseArgs(strategy),
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
        ytDlpCommandOptions('yt-dlp-sub', {
          id: strategy.id,
          label: `legenda ${candidate.language} (${strategy.id})`,
        }, deadline),
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
        strategy: strategy.id,
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
