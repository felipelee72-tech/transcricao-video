import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../utils/config.js';
import { getTools } from '../utils/binaries.js';
import { runCommand } from '../utils/process.js';

const directMediaExtensions = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mkv',
  '.mov',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.ogg',
  '.wav',
  '.webm',
]);

export function classifySource(inputUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    throw new Error('Informe uma URL valida.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('A URL precisa usar HTTP ou HTTPS.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTube =
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtube.com');

  if (isYouTube) {
    return { type: 'youtube', url: parsedUrl.toString() };
  }

  const extension = path.extname(parsedUrl.pathname).toLowerCase();
  if (directMediaExtensions.has(extension)) {
    return { type: 'direct', url: parsedUrl.toString() };
  }

  throw new Error('Use um link publico do YouTube ou um link direto para arquivo de audio/video.');
}

export function normalizeYouTubeUrl(inputUrl) {
  const parsedUrl = new URL(inputUrl);
  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  if (hostname === 'youtu.be') {
    const videoId = parsedUrl.pathname.slice(1).split('/')[0];
    if (!videoId) {
      throw new Error('URL do YouTube invalida.');
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (hostname.includes('youtube.com')) {
    const videoId = parsedUrl.searchParams.get('v');
    if (!videoId) {
      throw new Error('URL do YouTube invalida.');
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  return inputUrl;
}

export async function downloadAudio(source, jobDir) {
  if (source.type === 'youtube') {
    return downloadYouTubeAudio(source.url, jobDir);
  }

  return downloadDirectMedia(source.url, jobDir);
}

async function downloadYouTubeAudio(url, jobDir) {
  const tools = await getTools();
  const normalizedUrl = normalizeYouTubeUrl(url);
  const outputTemplate = path.join(jobDir, 'source.%(ext)s');
  const args = [
    '--no-playlist',
    '--max-filesize',
    String(config.maxSourceSizeBytes),
    '--js-runtimes',
    `node:${tools.nodePath}`,
    '-f',
    'ba/bestaudio',
    '-o',
    outputTemplate,
    normalizedUrl,
  ];

  console.log(`[yt-dlp] caminho do yt-dlp usado: ${tools.ytDlp}`);
  console.log(`[yt-dlp] URL normalizada: ${normalizedUrl}`);
  console.log(`[yt-dlp] args: ${JSON.stringify(args)}`);

  await runCommand(tools.ytDlp, args, {
    logPrefix: 'yt-dlp',
    strategy: 'spawn absoluto (.bin)',
  });

  const files = await fs.readdir(jobDir);
  const audioFile = files.find((file) => file.startsWith('source.'));

  if (!audioFile) {
    throw new Error('Nao foi possivel encontrar o audio baixado do YouTube.');
  }

  return path.join(jobDir, audioFile);
}

export async function bootstrapYtDlp() {
  return getTools();
}

async function downloadDirectMedia(url, jobDir) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error('Nao foi possivel baixar o arquivo informado.');
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > config.maxSourceSizeBytes) {
    throw new Error('O arquivo excede o tamanho maximo configurado.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/') && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new Error('O link direto precisa apontar para um arquivo de audio ou video.');
  }

  const extension = path.extname(new URL(url).pathname) || '.media';
  const outputPath = path.join(jobDir, `source${extension}`);

  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));

  const stats = await fs.stat(outputPath);
  if (stats.size > config.maxSourceSizeBytes) {
    throw new Error('O arquivo excede o tamanho maximo configurado.');
  }

  return outputPath;
}
