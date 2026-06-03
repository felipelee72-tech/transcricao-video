import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isFreeLinkTextMode } from './config.js';
import { buildYtDlpDiagnostics } from './ytDlpVersion.js';
import { runCommand } from './process.js';

const IS_WIN = process.platform === 'win32';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN_DIR = path.join(PROJECT_ROOT, '.bin');
const YT_DLP_BIN_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const YT_DLP_PATH = path.join(BIN_DIR, YT_DLP_BIN_NAME);
const FFMPEG_DIR = path.join(BIN_DIR, 'ffmpeg');
const FFMPEG_PATH = path.join(FFMPEG_DIR, IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
const FFPROBE_PATH = path.join(FFMPEG_DIR, IS_WIN ? 'ffprobe.exe' : 'ffprobe');

let cachedTools;
let cachedYtDlpDiagnostics = null;

export function getYtDlpDiagnostics() {
  return cachedYtDlpDiagnostics;
}

async function logYtDlpRuntimeInfo(binaryPath) {
  cachedYtDlpDiagnostics = await buildYtDlpDiagnostics(binaryPath);

  console.log('[tools] yt-dlp versao em execucao:', cachedYtDlpDiagnostics.version);
  console.log('[tools] yt-dlp caminho:', cachedYtDlpDiagnostics.path);

  if (cachedYtDlpDiagnostics.buildReleaseTag) {
    console.log(
      '[tools] yt-dlp build Render:',
      cachedYtDlpDiagnostics.buildReleaseTag,
      cachedYtDlpDiagnostics.buildVersion
        ? `(registrado: ${cachedYtDlpDiagnostics.buildVersion})`
        : '',
    );
  }

  if (cachedYtDlpDiagnostics.matchesBuild === false) {
    console.warn(
      '[tools] yt-dlp: versao em execucao difere da instalada no build',
      { runtime: cachedYtDlpDiagnostics.version, build: cachedYtDlpDiagnostics.buildVersion },
    );
  }

  if (!cachedYtDlpDiagnostics.available) {
    console.error('[tools] yt-dlp indisponivel:', cachedYtDlpDiagnostics.error);
  }
}

export async function bootstrapTools() {
  if (cachedTools) {
    return cachedTools;
  }

  await fs.mkdir(BIN_DIR, { recursive: true });

  const ytDlp = await ensureYtDlp();
  const { ffmpeg, ffprobe } = await ensureFfmpegBin();

  cachedTools = {
    ytDlp,
    ffmpeg,
    ffprobe,
    ffmpegDir: FFMPEG_DIR,
    nodePath: process.execPath,
  };

  await logYtDlpRuntimeInfo(ytDlp);
  console.log('[tools] ffmpeg:', ffmpeg);
  console.log('[tools] ffprobe:', ffprobe);

  return cachedTools;
}

export async function bootstrapYtDlpOnly() {
  await fs.mkdir(BIN_DIR, { recursive: true });
  const ytDlp = await ensureYtDlp();

  if (!cachedTools) {
    cachedTools = {
      ytDlp,
      ffmpeg: '',
      ffprobe: '',
      ffmpegDir: FFMPEG_DIR,
      nodePath: process.execPath,
    };
  } else {
    cachedTools.ytDlp = ytDlp;
  }

  await logYtDlpRuntimeInfo(ytDlp);
  return cachedTools;
}

export async function getTools() {
  if (isFreeLinkTextMode) {
    return bootstrapYtDlpOnly();
  }

  return bootstrapTools();
}

async function ensureYtDlp() {
  const isRender = process.env.RENDER === 'true';
  const candidates = [
    config.ytDlpPath,
    YT_DLP_PATH,
    ...(isRender
      ? []
      : [path.join(BIN_DIR, 'yt-dlp'), path.join(BIN_DIR, 'yt-dlp.exe')]),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      if (isRender) {
        console.log('[tools] Render: usando yt-dlp do build em', candidate);
      }

      return candidate;
    }
  }

  if (isRender) {
    throw new Error(
      'yt-dlp nao encontrado em .bin/yt-dlp. O build do Render deve baixar o binario em scripts/render-build.sh.',
    );
  }

  const pathBinary = await findYtDlpInPath();
  if (pathBinary) {
    console.warn('[tools] usando yt-dlp do PATH do sistema (nao o de .bin):', pathBinary);
    return pathBinary;
  }

  if (IS_WIN) {
    const sourcePath = await findExecutableSource('yt-dlp.exe', config.ytDlpPath, (name) =>
      name.toLowerCase().startsWith('yt-dlp.') && !name.toLowerCase().includes('ffmpeg'),
    );

    if (!sourcePath) {
      throw new Error('yt-dlp nao encontrado. Instale com: winget install yt-dlp.yt-dlp');
    }

    await copyFileSafe(sourcePath, YT_DLP_PATH);
    return YT_DLP_PATH;
  }

  throw new Error(
    'yt-dlp nao encontrado. No Render, o build deve instalar em .bin/yt-dlp ou defina YT_DLP_PATH.',
  );
}

async function findYtDlpInPath() {
  if (IS_WIN) {
    return findWithWhere('yt-dlp.exe');
  }

  try {
    const { stdout } = await runCommand('which', ['yt-dlp'], {
      logPrefix: 'tools-resolver',
      quiet: true,
    });
    const match = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (match && (await fileExists(match))) {
      console.log(`[tools] which yt-dlp: ${match}`);
      return match;
    }
  } catch {
    // try next
  }

  return null;
}

async function ensureFfmpegBin() {
  if (!IS_WIN) {
    const ffmpeg = await findUnixBinary('ffmpeg');
    const ffprobe = await findUnixBinary('ffprobe');

    if (ffmpeg && ffprobe) {
      return { ffmpeg, ffprobe };
    }

    throw new Error('ffmpeg nao encontrado. Necessario apenas no modo openai.');
  }

  await fs.mkdir(FFMPEG_DIR, { recursive: true });

  if ((await fileExists(FFMPEG_PATH)) && (await fileExists(FFPROBE_PATH)) && (await validateFfmpegExecutable())) {
    return { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH };
  }

  if (await fileExists(FFMPEG_DIR)) {
    await fs.rm(FFMPEG_DIR, { recursive: true, force: true });
    await fs.mkdir(FFMPEG_DIR, { recursive: true });
  }

  const sourceFfmpeg =
    (config.ffmpegPath && (await fileExists(config.ffmpegPath)) && config.ffmpegPath) ||
    (await findExecutableSource('ffmpeg.exe', '', (name) => name.toLowerCase().includes('ffmpeg')));

  if (!sourceFfmpeg) {
    throw new Error('ffmpeg nao encontrado. Instale com: winget install yt-dlp.FFmpeg');
  }

  const sourceDir = path.dirname(sourceFfmpeg);
  const files = await fs.readdir(sourceDir);

  for (const file of files) {
    await copyFileSafe(path.join(sourceDir, file), path.join(FFMPEG_DIR, file), true);
  }

  if (!(await fileExists(FFMPEG_PATH)) || !(await fileExists(FFPROBE_PATH)) || !(await validateFfmpegExecutable())) {
    throw new Error('ffmpeg/ffprobe invalidos apos copia para .bin/ffmpeg');
  }

  return { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH };
}

async function findUnixBinary(name) {
  if (config.ffmpegPath && name === 'ffmpeg' && (await fileExists(config.ffmpegPath))) {
    return config.ffmpegPath;
  }

  if (config.ffprobePath && name === 'ffprobe' && (await fileExists(config.ffprobePath))) {
    return config.ffprobePath;
  }

  try {
    const { stdout } = await runCommand('which', [name], { logPrefix: 'tools-resolver', quiet: true });
    const match = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (match && (await fileExists(match))) {
      return match;
    }
  } catch {
    return null;
  }

  return null;
}

async function validateFfmpegExecutable() {
  try {
    await runCommand(FFMPEG_PATH, ['-version'], { logPrefix: 'ffmpeg-validate', quiet: true });
    return true;
  } catch {
    return false;
  }
}

async function findExecutableSource(fileName, envPath, packageFilter) {
  if (envPath && (await fileExists(envPath))) {
    return envPath;
  }

  const wherePath = await findWithWhere(fileName);
  if (wherePath) {
    return wherePath;
  }

  return findInWinGetPackages(fileName, packageFilter);
}

async function findWithWhere(fileName) {
  if (!IS_WIN) {
    return null;
  }

  try {
    const { stdout } = await runCommand('where.exe', [fileName], { logPrefix: 'tools-resolver', quiet: true });
    const match = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (match) {
      console.log(`[tools] where.exe ${fileName}: ${match}`);
      return match;
    }
  } catch (error) {
    console.error(`[tools] where.exe ${fileName} falhou:`, error.message);
  }

  return null;
}

async function findInWinGetPackages(fileName, packageFilter) {
  if (!IS_WIN) {
    return null;
  }

  const packagesRoot = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!(await fileExists(packagesRoot))) {
    return null;
  }

  const packages = await fs.readdir(packagesRoot, { withFileTypes: true });
  for (const pkg of packages) {
    if (!pkg.isDirectory() || (packageFilter && !packageFilter(pkg.name))) {
      continue;
    }

    const directCandidate = path.join(packagesRoot, pkg.name, fileName);
    if (await fileExists(directCandidate)) {
      console.log(`[tools] WinGet ${fileName}: ${directCandidate}`);
      return directCandidate;
    }

    const nested = await findFileRecursively(path.join(packagesRoot, pkg.name), fileName, 5);
    if (nested) {
      return nested;
    }
  }

  return findFileRecursively(packagesRoot, fileName, 6);
}

async function findFileRecursively(dir, fileName, maxDepth, depth = 0) {
  if (depth > maxDepth) {
    return null;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      console.log(`[tools] encontrado ${fileName}: ${fullPath}`);
      return fullPath;
    }

    if (entry.isDirectory()) {
      const nested = await findFileRecursively(fullPath, fileName, maxDepth, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

async function copyFileSafe(sourcePath, destPath, force = false) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  if (!force && (await fileExists(destPath))) {
    try {
      const [sourceStat, destStat] = await Promise.all([fs.stat(sourcePath), fs.stat(destPath)]);
      if (sourceStat.size === destStat.size) {
        return;
      }
    } catch {
      // recopy below
    }
  }

  try {
    await fs.copyFile(sourcePath, destPath);
  } catch {
    const buffer = await fs.readFile(sourcePath);
    await fs.writeFile(destPath, buffer);
  }

  console.log(`[tools] copiado ${path.basename(destPath)} -> ${destPath}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
