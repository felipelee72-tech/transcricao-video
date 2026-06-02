import { useEffect, useState } from 'react';
import { apiUrl, getClientDiagnostics } from './lib/api.js';

export default function DebugPage() {
  const [health, setHealth] = useState({ status: 'loading' });
  const diagnostics = getClientDiagnostics();

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const startedAt = Date.now();
        const response = await fetch(apiUrl('/api/health'), {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        const elapsedMs = Date.now() - startedAt;

        setHealth({
          status: response.ok ? 'ok' : 'error',
          httpStatus: response.status,
          elapsedMs,
          body,
          error: response.ok ? '' : body?.error ?? 'Resposta HTTP nao OK',
        });
      } catch (error) {
        setHealth({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          hint:
            'ERR_ADDRESS_UNREACHABLE costuma ser rede/firewall/AP isolation, nao CORS. Confirme o IP do notebook e use http://IP:3001 no celular.',
        });
      }
    }

    void loadHealth();
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

        <p className="message">
          <a href="/">Voltar ao app</a>
        </p>
      </section>
    </main>
  );
}
