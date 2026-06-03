import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, getApiBaseUrl } from './lib/api.js';
import { failClientTranscription, runClientTranscription } from './lib/transcriptionClient.js';
import { formatTranscriptionError } from './lib/debugLog.js';
import { resolveJobUserMessage } from './lib/jobMessages.js';

const IS_DEV = import.meta.env.DEV;

const FREE_MODE_HERO =
  'Modo gratuito por link: o app tenta obter legendas, captions ou textos já disponíveis. Ele não transcreve áudio sem API paga.';

const OPENAI_MODE_HERO =
  'Modo OpenAI: transcreve áudio real via Supabase. Use link do YouTube ou arquivo direto de áudio/vídeo. Limite: 2 horas.';

function createIdleJob(transcriptionMode) {
  const freeMode = transcriptionMode === 'free-link-text';

  return {
    id: null,
    status: 'idle',
    phase: 'aguardando_link',
    progress: 0,
    message: freeMode
      ? 'Cole um link do YouTube, Instagram, TikTok ou Facebook.'
      : 'Cole um link publico do YouTube ou um link direto de audio/video.',
    result: '',
    error: '',
    platform: '',
    sourceType: 'none',
    success: false,
    code: '',
  };
}

const phaseLabels = {
  aguardando_link: 'Aguardando link',
  criando_tarefa: 'Criando tarefa',
  validando_url: 'Validando URL',
  identificando_plataforma: 'Identificando plataforma',
  extraindo_texto: 'Extraindo texto',
  baixando_audio: 'Baixando audio',
  convertendo_audio: 'Convertendo audio',
  dividindo_audio: 'Dividindo audio',
  transcrevendo: 'Transcrevendo',
  concluido: 'Concluido',
  erro: 'Erro',
};

const sourceTypeLabels = {
  subtitle: 'Legenda manual',
  'auto-caption': 'Legenda automatica',
  caption: 'Caption',
  metadata: 'Metadados',
  none: 'Nenhum',
};

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? data?.detail ?? fallbackMessage);
  }

  return data;
}

function formatErrorDetails(details) {
  if (!details) {
    return '';
  }

  return [
    `message: ${details.message ?? ''}`,
    `exitCode: ${details.exitCode ?? ''}`,
    `command: ${details.command ?? ''}`,
    `strategy: ${details.strategy ?? ''}`,
    `stdout:\n${details.stdout || '(vazio)'}`,
    `stderr:\n${details.stderr || '(vazio)'}`,
  ].join('\n\n');
}

function formatRequestError(error) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    const target = getApiBaseUrl() || window.location.origin;
    return `Nao foi possivel conectar ao backend (${target}). Abra pelo IP do notebook na porta 3001 ou use /debug.`;
  }

  return error instanceof Error ? error.message : 'Erro inesperado ao chamar o backend.';
}

function App() {
  const [appConfig, setAppConfig] = useState({
    transcriptionMode: 'free-link-text',
    freeLinkTextMode: true,
    openAiMode: false,
  });
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState(() => sessionStorage.getItem('appPassword') ?? '');
  const [job, setJob] = useState(() => createIdleJob('free-link-text'));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copiar texto');
  const transcribingJobIdRef = useRef(null);

  const isFreeMode = appConfig.transcriptionMode === 'free-link-text';

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(apiUrl('/api/config'));
        const data = await readJsonResponse(response, 'Nao foi possivel carregar a configuracao.');
        setAppConfig(data);
        setJob(createIdleJob(data.transcriptionMode));
      } catch {
        setJob(createIdleJob('free-link-text'));
      }
    };

    void loadConfig();
  }, []);

  const canSubmit = useMemo(
    () => url.trim().length > 0 && password.trim().length > 0 && !isSubmitting && !job.id,
    [url, password, isSubmitting, job.id],
  );
  const isRunning = job.id && !['completed', 'failed'].includes(job.status);
  const isPolling = isFreeMode ? isRunning : isRunning && job.status !== 'awaiting_transcription';

  useEffect(() => {
    if (!isPolling) {
      return undefined;
    }

    const pollStatus = async () => {
      try {
        const response = await fetch(apiUrl(`/api/transcriptions/${job.id}/status`));
        const data = await readJsonResponse(response, 'Nao foi possivel consultar o status.');

        setJob((currentJob) => {
          const merged = { ...currentJob, ...data };

          if (data.status === 'failed') {
            const userMessage = resolveJobUserMessage(merged);
            return {
              ...merged,
              message: userMessage,
              error: userMessage,
            };
          }

          return merged;
        });

        if (data.status === 'completed') {
          const resultResponse = await fetch(apiUrl(`/api/transcriptions/${job.id}`));
          const resultData = await readJsonResponse(resultResponse, 'Nao foi possivel buscar o resultado.');

          setJob((currentJob) => ({
            ...currentJob,
            result: resultData.text,
            platform: resultData.platform ?? currentJob.platform,
            sourceType: resultData.sourceType ?? currentJob.sourceType,
            success: resultData.success ?? true,
            code: resultData.code ?? currentJob.code,
            message: resultData.message ?? currentJob.message,
          }));
        }
      } catch (error) {
        setJob((currentJob) => ({
          ...currentJob,
          status: 'failed',
          phase: 'erro',
          error: formatRequestError(error),
          message: formatRequestError(error),
        }));
      }
    };

    pollStatus();
    const pollMs = job.status === 'processing' ? 1500 : 3000;
    const intervalId = window.setInterval(pollStatus, pollMs);
    return () => window.clearInterval(intervalId);
  }, [isPolling, job.id, job.status]);

  useEffect(() => {
    if (isFreeMode || job.status !== 'awaiting_transcription' || !job.id || !job.chunkCount) {
      return undefined;
    }

    if (transcribingJobIdRef.current === job.id) {
      return undefined;
    }

    transcribingJobIdRef.current = job.id;
    let cancelled = false;

    const transcribeJob = async () => {
      try {
        const completedJob = await runClientTranscription({
          jobId: job.id,
          chunkCount: job.chunkCount,
          password: password.trim(),
          onProgress: ({ progress, message }) => {
            if (cancelled) {
              return;
            }

            setJob((currentJob) => ({
              ...currentJob,
              progress,
              message,
              phase: 'transcrevendo',
            }));
          },
        });

        if (cancelled) {
          return;
        }

        const resultResponse = await fetch(apiUrl(`/api/transcriptions/${job.id}`));
        const resultData = await readJsonResponse(resultResponse, 'Nao foi possivel buscar a transcricao.');

        setJob((currentJob) => ({
          ...currentJob,
          ...completedJob,
          result: resultData.text,
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = formatTranscriptionError(error, { freeLinkMode: false });

        try {
          const failedJob = await failClientTranscription({
            jobId: job.id,
            password: password.trim(),
            error: message,
          });

          setJob((currentJob) => ({
            ...currentJob,
            ...failedJob,
            error: message,
          }));
        } catch {
          setJob((currentJob) => ({
            ...currentJob,
            status: 'failed',
            phase: 'erro',
            error: message,
            message,
          }));
        }
      }
    };

    void transcribeJob();

    return () => {
      cancelled = true;
    };
  }, [isFreeMode, job.status, job.id, job.chunkCount, password]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setCopyLabel(isFreeMode ? 'Copiar texto' : 'Copiar transcricao');
    setJob({
      ...createIdleJob(appConfig.transcriptionMode),
      status: 'queued',
      phase: 'criando_tarefa',
      progress: 2,
      message: isFreeMode ? 'Criando tarefa de extracao...' : 'Criando tarefa de transcricao...',
    });

    try {
      sessionStorage.setItem('appPassword', password.trim());

      const response = await fetch(apiUrl('/api/transcriptions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Password': password.trim(),
        },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await readJsonResponse(response, 'Nao foi possivel processar o link.');

      setJob((currentJob) => ({ ...currentJob, ...data }));
    } catch (error) {
      setJob({
        ...createIdleJob(appConfig.transcriptionMode),
        status: 'failed',
        phase: 'erro',
        error: formatRequestError(error),
        message: formatRequestError(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!job.result) {
      return;
    }

    await navigator.clipboard.writeText(job.result);
    setCopyLabel('Copiado!');
    window.setTimeout(() => setCopyLabel(isFreeMode ? 'Copiar texto' : 'Copiar transcricao'), 1800);
  }

  function handleReset() {
    setUrl('');
    setCopyLabel(isFreeMode ? 'Copiar texto' : 'Copiar transcricao');
    transcribingJobIdRef.current = null;
    setJob(createIdleJob(appConfig.transcriptionMode));
  }

  const heroText = isFreeMode ? FREE_MODE_HERO : OPENAI_MODE_HERO;
  const title = isFreeMode ? 'Extrair texto de links' : 'Transcreva audio ou video por link';
  const submitLabel = isFreeMode ? 'Extrair texto' : 'Transcrever';
  const resultTitle = isFreeMode ? 'Texto extraido' : 'Transcricao final';
  const resetLabel = isFreeMode ? 'Novo link' : 'Nova transcricao';

  return (
    <main className="page-shell">
      <section className="card">
        <div className="hero">
          <p className="eyebrow">{isFreeMode ? 'Modo gratuito por link' : 'Modo OpenAI'}</p>
          <h1>{title}</h1>
          <p>{heroText}</p>
          <p className="message meta">
            Acesso local: use <strong>http://IP-DO-NOTEBOOK:3001</strong> no celular.{' '}
            <a href="/debug">Diagnostico (/debug)</a>
          </p>
        </div>

        <form className="url-form" onSubmit={handleSubmit}>
          <label htmlFor="app-password">Senha de acesso</label>
          <input
            id="app-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha configurada no servidor"
            disabled={Boolean(job.id)}
            autoComplete="current-password"
            required
          />

          <label htmlFor="media-url">Link do video</label>
          <div className="input-row">
            <input
              id="media-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={
                isFreeMode
                  ? 'https://www.youtube.com/watch?v=...'
                  : 'https://www.youtube.com/watch?v=...'
              }
              disabled={Boolean(job.id)}
              required
            />
            <button type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Criando...' : submitLabel}
            </button>
          </div>
        </form>

        <section className="status-panel" aria-live="polite">
          <div className="status-header">
            <span>{phaseLabels[job.phase] ?? 'Status'}</span>
            <strong>{Math.round(job.progress)}%</strong>
          </div>
          <div className="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={job.progress}>
            <div style={{ width: `${job.progress}%` }} />
          </div>
          <p className={job.status === 'failed' ? 'message error' : 'message'}>
            {resolveJobUserMessage(job)}
          </p>
          {isFreeMode && job.platform && (
            <p className="message meta">
              Plataforma: {job.platform}
              {job.sourceType && job.sourceType !== 'none'
                ? ` · Fonte: ${sourceTypeLabels[job.sourceType] ?? job.sourceType}`
                : ''}
            </p>
          )}
          {IS_DEV && job.errorDetails && !job.code && (
            <pre className="error-details">{formatErrorDetails(job.errorDetails)}</pre>
          )}
        </section>

        {job.result && (
          <section className="result-panel">
            <div className="result-header">
              <h2>{resultTitle}</h2>
              <button type="button" className="secondary" onClick={handleCopy}>
                {copyLabel}
              </button>
            </div>
            <textarea value={job.result} readOnly />
          </section>
        )}

        {(job.status === 'completed' || job.status === 'failed') && (
          <button type="button" className="secondary full-width" onClick={handleReset}>
            {resetLabel}
          </button>
        )}
      </section>
    </main>
  );
}

export default App;
