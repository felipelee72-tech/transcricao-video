import { useEffect, useState } from 'react';
import { apiUrl, getClientDiagnostics } from './lib/api.js';

export default function DebugPage() {
  const [health, setHealth] = useState({ status: 'loading' });
  const [serverDiagnostics, setServerDiagnostics] = useState({ status: 'loading' });
  const diagnostics = getClientDiagnostics();

  useEffect(() => {
    const controller = new AbortController();

    async function loadEndpoint(path, setter) {
      try {
        const startedAt = Date.now();
        const response = await fetch(apiUrl(path), {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        const elapsedMs = Date.now() - startedAt;

        setter({
          status: response.ok ? 'ok' : 'error',
          httpStatus: response.status,
          elapsedMs,
          body,
          error: response.ok ? '' : body?.error ?? 'Resposta HTTP nao OK',
        });
      } catch (error) {
        setter({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          hint:
            'ERR_ADDRESS_UNREACHABLE costuma ser rede/firewall/AP isolation, nao CORS. Confirme o IP do notebook e use http://IP:3001 no celular.',
        });
      }
    }

    void loadEndpoint('/api/health', setHealth);
    void loadEndpoint('/api/diagnostics', setServerDiagnostics);
    return () => controller.abort();
  }, []);

  return (
    <main className="page-shell">
      <section className="card">
        <div className="hero">
          <p className="eyebrow">Diagnostico</p>
          <h1>Debug de rede</h1>
          <p>Use esta pagina no celular para saber se o problema e rede, frontend ou backend.</p>
        </div>

        <section className="status-panel">
          <h2>Cliente (navegador)</h2>
          <pre className="error-details">{JSON.stringify(diagnostics, null, 2)}</pre>
          <p className="message meta">userAgent: {navigator.userAgent}</p>
        </section>

        <section className="status-panel">
          <h2>GET /api/health</h2>
          <p className="message meta">URL: {diagnostics.resolvedApiHealthUrl}</p>
          {health.status === 'loading' && <p className="message">Testando conexao...</p>}
          {health.status !== 'loading' && (
            <pre className={health.status === 'ok' ? 'error-details' : 'error-details message error'}>
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
        </section>

        <section className="status-panel">
          <h2>GET /api/diagnostics</h2>
          <p className="message meta">yt-dlp em execucao no servidor (Render/local)</p>
          {serverDiagnostics.status === 'loading' && <p className="message">Carregando...</p>}
          {serverDiagnostics.status !== 'loading' && (
            <pre
              className={
                serverDiagnostics.status === 'ok' ? 'error-details' : 'error-details message error'
              }
            >
              {JSON.stringify(serverDiagnostics, null, 2)}
            </pre>
          )}
        </section>

        <p className="message">
          <a href="/">Voltar ao app</a>
        </p>
      </section>
    </main>
  );
}
