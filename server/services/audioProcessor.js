import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../utils/config.js';
import { getTools } from '../utils/binaries.js';
import { runCommand } from '../utils/process.js';

export async function prepareAudio(inputPath, jobDir) {
  const tools = await getTools();
  const durationSeconds = await getDurationSeconds(inputPath, tools.ffprobe);

  if (durationSeconds > config.maxDurationSeconds) {
    throw new Error(
      `Este video tem mais de ${config.maxDurationMinutes} minutos. O limite atual e de ${config.maxDurationMinutes} minutos (2 horas).`,
    );
  }

  const normalizedPath = path.join(jobDir, 'normalized.mp3');
  await runCommand(tools.ffmpeg, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    normalizedPath,
  ], { logPrefix: 'ffmpeg' });

  const chunksDir = path.join(jobDir, 'chunks');
  await fs.mkdir(chunksDir, { recursive: true });

  await runCommand(tools.ffmpeg, [
    '-y',
    '-i',
    normalizedPath,
    '-f',
    'segment',
    '-segment_time',
    String(config.chunkSeconds),
    '-reset_timestamps',
    '1',
    '-c',
    'copy',
    path.join(chunksDir, 'chunk-%03d.mp3'),
  ], { logPrefix: 'ffmpeg' });

  const chunkFiles = (await fs.readdir(chunksDir))
    .filter((file) => file.endsWith('.mp3'))
    .sort()
    .map((file) => path.join(chunksDir, file));

  if (chunkFiles.length === 0) {
    throw new Error('Nao foi possivel dividir o audio para transcricao.');
  }

  return {
    durationSeconds,
    chunks: chunkFiles,
  };
}

async function getDurationSeconds(inputPath, ffprobePath) {
  const { stdout } = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ], { logPrefix: 'ffprobe' });

  const duration = Number(stdout.trim());

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Nao foi possivel identificar a duracao da midia.');
  }

  return duration;
}
