/**
 * Teste de integracao local (health + extracao YouTube).
 * Uso: node scripts/integration-test.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || '';
const TEST_URL =
  process.env.TEST_YOUTUBE_URL || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

async function main() {
  if (!PASSWORD) {
    console.error('APP_PASSWORD nao definida no .env');
    process.exit(1);
  }

  console.log('[test] health...');
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.json();
  console.log('[test] health', health.status, healthBody);

  if (!health.ok) {
    process.exit(1);
  }

  console.log('[test] criando job...');
  const createRes = await fetch(`${BASE}/api/transcriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Password': PASSWORD,
    },
    body: JSON.stringify({ url: TEST_URL }),
  });

  const job = await createRes.json();
  console.log('[test] job criado', createRes.status, job);

  if (!createRes.ok || !job.id) {
    process.exit(1);
  }

  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    await sleep(2000);
    const statusRes = await fetch(`${BASE}/api/transcriptions/${job.id}/status`);
    const status = await statusRes.json();
    console.log('[test] status', status.status, status.phase, status.progress, status.code ?? '');

    if (status.status === 'completed') {
      const resultRes = await fetch(`${BASE}/api/transcriptions/${job.id}`);
      const result = await resultRes.json();
      console.log('[test] SUCESSO', {
        success: result.success,
        sourceType: result.sourceType,
        textLen: result.text?.length,
        message: result.message?.slice(0, 120),
      });
      process.exit(0);
    }

    if (status.status === 'failed') {
      console.log('[test] FALHA', {
        code: status.code,
        message: status.message,
        error: status.error?.slice(0, 200),
      });
      process.exit(1);
    }
  }

  console.error('[test] timeout aguardando job');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('[test] erro', error);
  process.exit(1);
});
