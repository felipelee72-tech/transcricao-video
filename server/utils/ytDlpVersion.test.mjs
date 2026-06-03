import assert from 'node:assert/strict';
import test from 'node:test';
import { probeYtDlpVersion } from './ytDlpVersion.js';

test('probeYtDlpVersion retorna estrutura esperada com binario invalido', async () => {
  const result = await probeYtDlpVersion('/caminho/inexistente/yt-dlp');

  assert.equal(result.available, false);
  assert.equal(result.path, '/caminho/inexistente/yt-dlp');
  assert.match(result.error, /./);
});
