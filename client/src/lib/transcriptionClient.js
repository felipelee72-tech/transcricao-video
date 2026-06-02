import { apiUrl } from './api.js';
import { transcribeAudioFile } from './transcribe.js';

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? fallbackMessage);
  }

  return data;
}

export async function runClientTranscription({ jobId, chunkCount, password, onProgress }) {
  const texts = [];

  for (let index = 0; index < chunkCount; index += 1) {
    onProgress?.({
      current: index + 1,
      total: chunkCount,
      progress: 55 + Math.round((index / chunkCount) * 40),
      message: `Transcrevendo parte ${index + 1} de ${chunkCount}.`,
    });

    const chunkResponse = await fetch(apiUrl(`/api/transcriptions/${jobId}/chunks/${index}`), {
      headers: {
        'X-App-Password': password,
      },
    });

    if (!chunkResponse.ok) {
      throw new Error(`Nao foi possivel baixar o chunk ${index + 1}.`);
    }

    const blob = await chunkResponse.blob();
    const file = new File([blob], `chunk-${index + 1}.mp3`, {
      type: blob.type || 'audio/mpeg',
    });
    const text = await transcribeAudioFile(file);
    texts.push(text.trim());
  }

  const combinedText = texts.filter(Boolean).join('\n\n');

  const completeResponse = await fetch(apiUrl(`/api/transcriptions/${jobId}/complete`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Password': password,
    },
    body: JSON.stringify({ text: combinedText }),
  });

  return readJsonResponse(completeResponse, 'Nao foi possivel concluir a transcricao.');
}

export async function failClientTranscription({ jobId, password, error }) {
  const response = await fetch(apiUrl(`/api/transcriptions/${jobId}/fail`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Password': password,
    },
    body: JSON.stringify({ error }),
  });

  return readJsonResponse(response, 'Nao foi possivel registrar a falha da transcricao.');
}
