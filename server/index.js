import './utils/env.js';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  completeTranscriptionJob,
  createTranscriptionJob,
  failTranscriptionJob,
  getTranscriptionChunkPath,
  getTranscriptionJob,
  getTranscriptionResult,
} from './jobs/transcriptionJobs.js';
import { bootstrapTools, bootstrapYtDlpOnly, getYtDlpDiagnostics } from './utils/binaries.js';
import { config, isFreeLinkTextMode, isOpenAiMode } from './utils/config.js';
import { getLanIpv4Addresses, getPrimaryLanIp } from './utils/network.js';
import { initYtDlpCookies } from './utils/ytDlpCookies.js';

const app = express();
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigin(origin) || config.allowLanOrigins) {
        callback(null, true);
        return;
      }

      callback(new Error('Origem nao permitida pelo CORS.'));
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

function buildHealthPayload(request) {
  const ytDlp = getYtDlpDiagnostics();

  return {
    ok: true,
    host: request.hostname,
    ip: getPrimaryLanIp(),
    ips: getLanIpv4Addresses(),
    mode: config.transcriptionMode,
    timestamp: new Date().toISOString(),
    ytDlp: ytDlp
      ? {
          version: ytDlp.version,
          available: ytDlp.available,
        }
      : null,
  };
}

function buildDiagnosticsPayload(request) {
  const ytDlp = getYtDlpDiagnostics();

  return {
    ok: true,
    host: request.hostname,
    render: process.env.RENDER === 'true',
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    nodeVersion: process.version,
    mode: config.transcriptionMode,
    timestamp: new Date().toISOString(),
    ytDlp: ytDlp ?? {
      path: '',
      version: 'not_loaded',
      available: false,
      error: 'Ferramentas ainda nao inicializadas.',
      buildVersion: null,
      buildReleaseTag: null,
      matchesBuild: null,
    },
    cookiesConfigured: Boolean(process.env.YT_DLP_COOKIES_CONTENT?.trim() || process.env.YT_DLP_COOKIES_FILE?.trim()),
  };
}

app.get('/health', (request, response) => {
  response.json(buildHealthPayload(request));
});

app.get('/api/health', (request, response) => {
  response.json(buildHealthPayload(request));
});

app.get('/api/diagnostics', (request, response) => {
  response.json(buildDiagnosticsPayload(request));
});

app.get('/api/config', (_request, response) => {
  response.json({
    transcriptionMode: config.transcriptionMode,
    freeLinkTextMode: isFreeLinkTextMode,
    openAiMode: isOpenAiMode,
    supabaseUrl: isOpenAiMode ? config.supabaseUrl : '',
    supabaseAnonKey: isOpenAiMode ? config.supabaseAnonKey : '',
    supabaseConfigured: isOpenAiMode && Boolean(config.supabaseUrl && config.supabaseAnonKey),
    maxDurationMinutes: isOpenAiMode ? config.maxDurationMinutes : null,
    supportsFileUpload: false,
  });
});

app.post('/api/transcriptions', (request, response) => {
  if (!requireAppPassword(request, response)) {
    return;
  }

  const { url } = request.body ?? {};

  if (typeof url !== 'string' || url.trim().length === 0) {
    response.status(400).json({
      error: isFreeLinkTextMode ? 'Informe um link publico.' : 'Informe um link para transcrever.',
    });
    return;
  }

  const job = createTranscriptionJob(url.trim());
  response.status(202).json(job);
});

app.get('/api/transcriptions/:id/status', (request, response) => {
  const job = getTranscriptionJob(request.params.id);

  if (!job) {
    response.status(404).json({ error: 'Transcricao nao encontrada.' });
    return;
  }

  response.json(job);
});

app.get('/api/transcriptions/:id', (request, response) => {
  const result = getTranscriptionResult(request.params.id);

  if (!result) {
    response.status(404).json({ error: 'Transcricao nao encontrada.' });
    return;
  }

  if (result.pending) {
    response.status(409).json({
      error: 'A transcricao ainda nao foi concluida.',
      job: result.job,
    });
    return;
  }

  response.json(result);
});

app.get('/api/transcriptions/:id/chunks/:index', (request, response) => {
  if (isFreeLinkTextMode) {
    response.status(404).json({ error: 'Chunks nao disponiveis no modo gratuito por link.' });
    return;
  }

  console.log('[api] GET /api/transcriptions/:id/chunks/:index', {
    id: request.params.id,
    index: request.params.index,
    contentType: request.get('content-type') ?? '(ausente)',
  });

  if (!requireAppPassword(request, response)) {
    return;
  }

  const chunkIndex = Number.parseInt(request.params.index, 10);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    response.status(400).json({ error: 'Indice de chunk invalido.' });
    return;
  }

  const chunkPath = getTranscriptionChunkPath(request.params.id, chunkIndex);
  if (!chunkPath) {
    response.status(404).json({ error: 'Chunk nao encontrado ou job indisponivel.' });
    return;
  }

  response.sendFile(path.resolve(chunkPath));
});

app.post('/api/transcriptions/:id/complete', (request, response) => {
  if (isFreeLinkTextMode) {
    response.status(404).json({ error: 'Conclusao manual nao disponivel no modo gratuito por link.' });
    return;
  }

  console.log('[api] POST /api/transcriptions/:id/complete', {
    id: request.params.id,
    contentType: request.get('content-type') ?? '(ausente)',
    bodyType: typeof request.body,
    textLength: typeof request.body?.text === 'string' ? request.body.text.length : null,
  });

  if (!requireAppPassword(request, response)) {
    return;
  }

  const { text } = request.body ?? {};
  if (typeof text !== 'string' || text.trim().length === 0) {
    response.status(400).json({ error: 'Informe o texto transcrito.' });
    return;
  }

  const job = completeTranscriptionJob(request.params.id, text.trim());
  if (!job) {
    response.status(404).json({ error: 'Transcricao nao encontrada ou nao aguardando resultado.' });
    return;
  }

  response.json(job);
});

app.post('/api/transcriptions/:id/fail', (request, response) => {
  if (isFreeLinkTextMode) {
    response.status(404).json({ error: 'Falha manual nao disponivel no modo gratuito por link.' });
    return;
  }

  if (!requireAppPassword(request, response)) {
    return;
  }

  const { error } = request.body ?? {};
  const message = typeof error === 'string' && error.trim().length > 0 ? error.trim() : 'Falha na transcricao.';

  console.log('[api] POST /api/transcriptions/:id/fail', {
    id: request.params.id,
    errorPreview: message.slice(0, 200),
  });

  const job = failTranscriptionJob(request.params.id, message);
  if (!job) {
    response.status(404).json({ error: 'Transcricao nao encontrada.' });
    return;
  }

  response.json(job);
});

if (config.serveClient) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Erro inesperado no servidor.' });
});

async function startServer() {
  try {
    await initYtDlpCookies();
  } catch (error) {
    console.warn('[cookies] falha ao inicializar cookies yt-dlp:', error instanceof Error ? error.message : error);
  }

  const bootstrap = isFreeLinkTextMode ? bootstrapYtDlpOnly : bootstrapTools;

  try {
    await bootstrap();
  } catch (error) {
    console.error('[tools] falha ao preparar ferramentas na inicializacao:', error);
  }

  const lanIps = getLanIpv4Addresses();
  const primaryLanIp = getPrimaryLanIp();

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Servidor ouvindo em http://localhost:${config.port} (bind 0.0.0.0:${config.port})`);
    if (process.env.RENDER_EXTERNAL_URL) {
      console.log(`[server] URL publica (Render): ${process.env.RENDER_EXTERNAL_URL}`);
    }
    console.log(`[server] modo: ${config.transcriptionMode}`);
    console.log(`[server] serveClient: ${config.serveClient}`);
    if (isFreeLinkTextMode) {
      console.log('[server] arquitetura: extracao de legendas/captions via yt-dlp (sem OpenAI)');
    } else {
      console.log('[server] arquitetura: download/ffmpeg local + transcricao via Supabase Edge Function (frontend)');
    }
    console.log('[config] transcricao', {
      mode: config.transcriptionMode,
      usesLocalOpenAiKey: false,
      appPasswordConfigured: Boolean(config.appPassword),
      supabaseConfigured: isOpenAiMode && Boolean(config.supabaseUrl && config.supabaseAnonKey),
      clientOrigin: config.clientOrigin,
      allowLanOrigins: config.allowLanOrigins,
    });
    console.log('[server] diagnostico UI: http://localhost:' + config.port + '/debug');
    console.log('[server] diagnostico API: http://localhost:' + config.port + '/api/diagnostics');
    if (primaryLanIp) {
      console.log(`Celular (mesma Wi-Fi): http://${primaryLanIp}:${config.port}`);
      console.log(`Celular debug: http://${primaryLanIp}:${config.port}/debug`);
    }
    if (lanIps.length > 1) {
      console.log('[server] IPs locais detectados:', lanIps.join(', '));
    }
  }).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[server] porta ${config.port} em uso. Rode: npm run prestart`);
      console.error('[server] provavel servidor antigo ainda rodando (codigo legado com OPENAI local).');
    } else {
      console.error('[server] falha ao iniciar:', error);
    }

    process.exit(1);
  });
}

startServer().catch((error) => {
  console.error('[server] falha fatal ao iniciar:', error);
  process.exit(1);
});

function requireAppPassword(request, response) {
  if (!config.appPassword) {
    response.status(503).json({ error: 'Servidor sem APP_PASSWORD configurada.' });
    return false;
  }

  const providedPassword = request.get('X-App-Password');
  if (providedPassword !== config.appPassword) {
    response.status(401).json({ error: 'Senha invalida.' });
    return false;
  }

  return true;
}

function allowedOrigin(origin) {
  if (config.clientOrigin && origin === config.clientOrigin) {
    return true;
  }

  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl && origin === renderUrl) {
    return true;
  }

  if (config.devClientOrigins.includes(origin)) {
    return true;
  }

  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }

    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }

    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}
