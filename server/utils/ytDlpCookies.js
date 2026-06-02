import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let cachedCookiesPath = null;

/**
 * Materializa cookies Netscape a partir de arquivo ou variavel de ambiente.
 * YT_DLP_COOKIES_FILE = caminho absoluto
 * YT_DLP_COOKIES_CONTENT = conteudo Netscape (util no Render Secret)
 */
export function getYtDlpCookiesPath() {
  return cachedCookiesPath;
}

export async function initYtDlpCookies() {
  if (cachedCookiesPath) {
    return cachedCookiesPath;
  }

  const filePath = process.env.YT_DLP_COOKIES_FILE?.trim();
  if (filePath) {
    try {
      await fs.access(filePath);
      cachedCookiesPath = filePath;
      console.log('[cookies] usando arquivo:', filePath);
      return cachedCookiesPath;
    } catch {
      console.warn('[cookies] YT_DLP_COOKIES_FILE nao encontrado:', filePath);
    }
  }

  const content = process.env.YT_DLP_COOKIES_CONTENT?.trim();
  if (!content) {
    return null;
  }

  const target = path.join(os.tmpdir(), 'yt-dlp-cookies.txt');
  await fs.writeFile(target, content, 'utf8');
  cachedCookiesPath = target;
  console.log('[cookies] arquivo temporario criado para yt-dlp');
  return cachedCookiesPath;
}
