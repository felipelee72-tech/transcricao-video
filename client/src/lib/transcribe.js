import { getSupabaseConfig } from './supabaseConfig.js';
import { formatTranscriptionError } from './debugLog.js';

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? fallbackMessage);
  }

  return data;
}

export async function transcribeAudioFile(file) {
  const { supabaseUrl, supabaseAnonKey } = await getSupabaseConfig();

  console.info('[transcribe] invoking supabase function', {
    supabaseUrl,
    functionName: 'transcrever',
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  });

  const formData = new FormData();
  formData.append('file', file, file.name || 'audio.mp3');

  const response = await fetch(`${supabaseUrl}/functions/v1/transcrever`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: formData,
  });

  const rawBody = await response.text();
  let data = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = formatTranscriptionError(new Error(data?.error ?? rawBody));
    throw new Error(err);
  }

  console.info('[transcribe] supabase response', {
    status: response.status,
    dataError: data?.error ?? null,
    textLength: typeof data?.text === 'string' ? data.text.length : null,
  });

  if (data?.error) {
    throw new Error(formatTranscriptionError(new Error(data.error)));
  }

  if (!data?.text) {
    throw new Error('Resposta da transcricao invalida.');
  }

  return data.text;
}
