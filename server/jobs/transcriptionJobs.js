import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareAudio } from '../services/audioProcessor.js';
import { classifySource, downloadAudio } from '../services/downloader.js';
import { classifyLinkPlatform } from '../services/linkClassifier.js';
import { extractLinkText } from '../services/linkTextExtractor.js';
import { config, isFreeLinkTextMode } from '../utils/config.js';
import { CommandExecutionError } from '../utils/process.js';

const jobs = new Map();
const queue = [];
let isWorkerRunning = false;

export function createTranscriptionJob(url) {
  const id = randomUUID();
  const job = {
    id,
    url,
    status: 'queued',
    phase: 'criando_tarefa',
    progress: 5,
    message: isFreeLinkTextMode
      ? 'Tarefa criada. Buscando textos disponiveis no link.'
      : 'Tarefa criada. Aguardando processamento.',
    text: '',
    error: '',
    errorDetails: null,
    platform: '',
    sourceType: 'none',
    success: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  jobs.set(id, job);
  queue.push(id);
  console.log(`[jobs] job criado: ${id} (modo ${config.transcriptionMode})`);
  runQueue();

  return publicJob(job);
}

export function getTranscriptionJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function getTranscriptionChunkPath(id, index) {
  if (isFreeLinkTextMode) {
    return null;
  }

  const job = jobs.get(id);
  if (!job || job.status !== 'awaiting_transcription') {
    return null;
  }

  const chunkPath = job.chunkPaths?.[index];
  if (!chunkPath) {
    return null;
  }

  return chunkPath;
}

export function completeTranscriptionJob(id, text) {
  const job = jobs.get(id);
  if (!job || job.status !== 'awaiting_transcription') {
    return null;
  }

  updateJob(job, {
    status: 'completed',
    phase: 'concluido',
    progress: 100,
    message: 'Transcricao concluida.',
    text,
    success: true,
  });

  void cleanupJobDir(job);
  console.log(`[jobs] job concluido: ${id}`);
  return publicJob(job);
}

export function failTranscriptionJob(id, message) {
  const job = jobs.get(id);
  if (!job || job.status !== 'awaiting_transcription') {
    return null;
  }

  updateJob(job, {
    status: 'failed',
    phase: 'erro',
    message,
    error: message,
    success: false,
  });

  void cleanupJobDir(job);
  return publicJob(job);
}

async function cleanupJobDir(job) {
  if (!job.jobDir) {
    return;
  }

  await fs.rm(job.jobDir, { recursive: true, force: true });
  job.jobDir = '';
  job.chunkPaths = [];
}

export function getTranscriptionResult(id) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  if (job.status !== 'completed') {
    return { pending: true, job: publicJob(job) };
  }

  const result = {
    id: job.id,
    text: job.text,
    success: job.success ?? true,
    platform: job.platform ?? '',
    sourceType: job.sourceType ?? 'none',
    message: job.message ?? '',
  };

  return result;
}

function runQueue() {
  if (isWorkerRunning) {
    return;
  }

  isWorkerRunning = true;
  setImmediate(() => {
    processQueue().catch((error) => {
      console.error('[jobs] erro inesperado no worker:', error);
      isWorkerRunning = false;

      if (queue.length > 0) {
        runQueue();
      }
    });
  });
}

async function processQueue() {
  try {
    while (queue.length > 0) {
      const id = queue.shift();
      const job = jobs.get(id);

      if (job) {
        await processJob(job);
      }
    }
  } finally {
    isWorkerRunning = false;
  }
}

async function processJob(job) {
  const jobDir = path.join(config.tempRoot, job.id);

  if (isFreeLinkTextMode) {
    await processFreeLinkJob(job, jobDir);
    return;
  }

  await processOpenAiJob(job, jobDir);
}

async function processFreeLinkJob(job, jobDir) {
  try {
    updateJob(job, {
      status: 'processing',
      phase: 'validando_url',
      progress: 10,
      message: 'Validando link informado.',
    });

    await fs.mkdir(jobDir, { recursive: true });
    job.jobDir = jobDir;

    const link = classifyLinkPlatform(job.url);

    updateJob(job, {
      phase: 'identificando_plataforma',
      progress: 25,
      message: `Plataforma identificada: ${link.platform}.`,
      platform: link.platform,
    });

    if (link.platform === 'unsupported') {
      updateJob(job, {
        status: 'failed',
        phase: 'erro',
        progress: 100,
        message:
          'Plataforma nao suportada no modo gratuito. Use links do YouTube, Instagram, TikTok ou Facebook.',
        error:
          'Plataforma nao suportada no modo gratuito. Use links do YouTube, Instagram, TikTok ou Facebook.',
        success: false,
        sourceType: 'none',
      });
      await cleanupJobDir(job);
      return;
    }

    updateJob(job, {
      phase: 'extraindo_texto',
      progress: 55,
      message: 'Buscando legendas, captions ou textos ja disponiveis.',
    });

    console.log(`[jobs] extracao iniciada: ${job.id}`, {
      platform: link.platform,
    });

    const extraction = await extractLinkText(job.url, jobDir);

    if (extraction.log?.subtitleLanguage) {
      console.log(`[jobs] legenda escolhida: ${job.id}`, {
        platform: extraction.platform,
        title: extraction.log.title || undefined,
        language: extraction.log.subtitleLanguage,
        sourceType: extraction.sourceType,
        ...(config.debugYtDlp && extraction.log.subtitleFilePath
          ? { subtitleFilePath: extraction.log.subtitleFilePath }
          : {}),
      });
    }

    console.log(`[jobs] extracao concluida: ${job.id}`, {
      success: extraction.success,
      platform: extraction.platform,
      sourceType: extraction.sourceType,
      title: extraction.log?.title || undefined,
    });

    if (extraction.success && extraction.text) {
      updateJob(job, {
        status: 'completed',
        phase: 'concluido',
        progress: 100,
        message: extraction.message,
        text: extraction.text,
        platform: extraction.platform,
        sourceType: extraction.sourceType,
        success: true,
        error: '',
      });
      await cleanupJobDir(job);
      return;
    }

    updateJob(job, {
      status: 'failed',
      phase: 'erro',
      progress: 100,
      message: extraction.message,
      error: extraction.message,
      text: '',
      platform: extraction.platform,
      sourceType: extraction.sourceType,
      success: false,
    });
    await cleanupJobDir(job);
  } catch (error) {
    const errorDetails = serializeError(error);
    console.error(`[jobs] extracao falhou: ${job.id}`, {
      message: errorDetails.message,
      ...(config.debugYtDlp
        ? { stderr: errorDetails.stderr, exitCode: errorDetails.exitCode }
        : {}),
    });
    updateJob(job, {
      status: 'failed',
      phase: 'erro',
      progress: job.progress,
      message: errorDetails.message,
      error: errorDetails.message,
      errorDetails,
      success: false,
    });
    await cleanupJobDir(job);
  }
}

async function processOpenAiJob(job, jobDir) {
  try {
    updateJob(job, {
      status: 'processing',
      phase: 'validando_url',
      progress: 8,
      message: 'Validando se o link e aceito pelo modo OpenAI.',
    });
    await fs.mkdir(jobDir, { recursive: true });
    const source = classifySource(job.url);

    updateJob(job, {
      phase: 'baixando_audio',
      progress: 18,
      message: source.type === 'youtube' ? 'Baixando apenas o audio do YouTube.' : 'Baixando arquivo de audio/video.',
    });
    console.log(`[jobs] inicio do download: ${job.id}`);
    const downloadedPath = await downloadAudio(source, jobDir);
    console.log(`[jobs] fim do download: ${job.id}`);

    updateJob(job, {
      phase: 'convertendo_audio',
      progress: 38,
      message: 'Convertendo audio para um formato adequado.',
    });
    console.log(`[jobs] inicio do processamento ffmpeg: ${job.id}`);

    updateJob(job, {
      phase: 'dividindo_audio',
      progress: 48,
      message: 'Dividindo audio em blocos temporarios.',
    });
    const { chunks } = await prepareAudio(downloadedPath, jobDir);
    console.log(`[jobs] chunks gerados: ${job.id} (${chunks.length})`);

    job.jobDir = jobDir;
    job.chunkPaths = chunks;

    updateJob(job, {
      status: 'awaiting_transcription',
      phase: 'transcrevendo',
      progress: 55,
      message: `Audio pronto. Transcrevendo ${chunks.length} parte(s) via Supabase.`,
      chunkCount: chunks.length,
    });
    console.log(`[jobs] aguardando transcricao no frontend: ${job.id}`);
  } catch (error) {
    const errorDetails = serializeError(error);
    console.error(`[jobs] erro do job: ${job.id}`, errorDetails);
    updateJob(job, {
      status: 'failed',
      phase: 'erro',
      progress: job.progress,
      message: errorDetails.message,
      error: errorDetails.message,
      errorDetails,
    });
    await cleanupJobDir(job);
  }
}

function updateJob(job, updates) {
  Object.assign(job, updates, {
    updatedAt: new Date().toISOString(),
  });
}

function publicJob(job) {
  const payload = {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  if (isFreeLinkTextMode) {
    payload.platform = job.platform ?? '';
    payload.sourceType = job.sourceType ?? 'none';
    payload.success = job.success ?? false;
  }

  if (config.isDevelopment && job.errorDetails) {
    payload.errorDetails = job.errorDetails;
  }

  if (job.status === 'awaiting_transcription' && job.chunkCount) {
    payload.chunkCount = job.chunkCount;
  }

  return payload;
}

function serializeError(error) {
  if (error instanceof CommandExecutionError) {
    return error.toDetails();
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    stdout: '',
    stderr: '',
    exitCode: null,
    command: '',
    strategy: '',
  };
}
