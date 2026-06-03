import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './process.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN_DIR = path.join(PROJECT_ROOT, '.bin');

export async function probeYtDlpVersion(binaryPath) {
  if (!binaryPath) {
    return {
      path: '',
      version: 'unavailable',
      available: false,
      error: 'Binario yt-dlp nao configurado.',
    };
  }

  try {
    const { stdout } = await runCommand(binaryPath, ['--version'], {
      logPrefix: 'yt-dlp-version',
      quiet: true,
      timeoutMs: 15_000,
    });

    const version = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? 'unknown';

    return {
      path: binaryPath,
      version,
      available: true,
      error: '',
    };
  } catch (error) {
    return {
      path: binaryPath,
      version: 'unknown',
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readYtDlpBuildMetadata() {
  try {
    const [version, releaseTag] = await Promise.all([
      fs.readFile(path.join(BIN_DIR, 'yt-dlp.version'), 'utf8'),
      fs.readFile(path.join(BIN_DIR, 'yt-dlp.release'), 'utf8').catch(() => ''),
    ]);

    return {
      buildVersion: version.trim(),
      releaseTag: releaseTag.trim() || undefined,
    };
  } catch {
    return null;
  }
}

export async function buildYtDlpDiagnostics(binaryPath) {
  const runtime = await probeYtDlpVersion(binaryPath);
  const build = await readYtDlpBuildMetadata();

  return {
    ...runtime,
    buildVersion: build?.buildVersion ?? null,
    buildReleaseTag: build?.releaseTag ?? null,
    matchesBuild:
      build?.buildVersion && runtime.available
        ? build.buildVersion === runtime.version
        : null,
    render: process.env.RENDER === 'true',
  };
}
