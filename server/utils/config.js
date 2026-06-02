import os from 'node:os';
import path from 'node:path';

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const rawTranscriptionMode = (process.env.TRANSCRIPTION_MODE || 'free-link-text').trim().toLowerCase();

function resolveListenHost() {
  const raw = (process.env.HOST || '0.0.0.0').trim().toLowerCase();

  if (raw === 'localhost' || raw === '127.0.0.1' || raw === '::1') {
    return '0.0.0.0';
  }

  return raw || '0.0.0.0';
}

export const config = {
  transcriptionMode: rawTranscriptionMode === 'openai' ? 'openai' : 'free-link-text',
  port: Number(process.env.PORT) || 3001,
  clientOrigin:
    process.env.CLIENT_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    'http://localhost:5173',
  isRender: Boolean(process.env.RENDER),
  devClientOrigins: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
  ],
  tempRoot:
    process.env.TRANSCRIPTION_TMP_DIR ||
    path.join(os.tmpdir(), 'transcriptions'),
  maxSourceSizeBytes: numberFromEnv('MAX_SOURCE_SIZE_MB', 500) * 1024 * 1024,
  maxDurationMinutes: numberFromEnv('MAX_DURATION_MINUTES', 120),
  maxDurationSeconds: numberFromEnv('MAX_DURATION_MINUTES', 120) * 60,
  chunkMinutes: numberFromEnv('CHUNK_MINUTES', 10),
  chunkSeconds: numberFromEnv('CHUNK_MINUTES', 10) * 60,
  appPassword: process.env.APP_PASSWORD || '',
  isDevelopment:
    process.env.NODE_ENV !== 'production' && !process.env.RENDER,
  isProduction: process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER),
  ytDlpPath: process.env.YT_DLP_PATH || '',
  ffmpegPath: process.env.FFMPEG_PATH || '',
  ffprobePath: process.env.FFPROBE_PATH || '',
  host: resolveListenHost(),
  allowLanOrigins: process.env.ALLOW_LAN_ORIGINS !== 'false',
  serveClient: process.env.SERVE_CLIENT !== 'false',
  supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
  debugYtDlp: process.env.DEBUG_YTDLP === 'true',
};

export const isFreeLinkTextMode = config.transcriptionMode === 'free-link-text';
export const isOpenAiMode = config.transcriptionMode === 'openai';
