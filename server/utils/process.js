import { spawn } from 'node:child_process';
import { isYouTubeBotError, YOUTUBE_BOT_USER_MESSAGE } from '../services/youtubeBotError.js';

export class CommandExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CommandExecutionError';
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.exitCode = details.exitCode ?? null;
    this.command = details.command ?? '';
    this.strategy = details.strategy ?? '';
  }

  toDetails() {
    return {
      message: this.message,
      stdout: this.stdout,
      stderr: this.stderr,
      exitCode: this.exitCode,
      command: this.command,
      strategy: this.strategy,
    };
  }
}

export function summarizeProcessOutput(text, maxLength = 400) {
  if (!text) {
    return '';
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[download\]\s+\d/.test(line));

  const meaningful = lines.filter((line) => !/^(\[info\]|\[debug\])\s/i.test(line) || /error|warning|unable|failed/i.test(line));
  const selected = (meaningful.length > 0 ? meaningful : lines).slice(-5);
  const joined = selected.join(' | ');

  if (joined.length <= maxLength) {
    return joined;
  }

  return `${joined.slice(0, maxLength)}...`;
}

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { logPrefix, strategy, quiet = false, timeoutMs = 35_000, ...spawnOptions } = options;
    const commandLine = formatCommand(command, args);
    const prefix = logPrefix ? `[${logPrefix}]` : `[${command}]`;

    if (quiet) {
      if (strategy) {
        console.log(`${prefix} executando: ${strategy}`);
      }
    } else {
      console.log(`${prefix} comando executado: ${commandLine}`);
      console.log(`${prefix} args: ${JSON.stringify(args)}`);
      if (strategy) {
        console.log(`${prefix} estrategia utilizada: ${strategy}`);
      }
    }

    const child = spawn(command, args, {
      windowsHide: true,
      ...spawnOptions,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const settle = (handler) => {
      if (settled) {
        return;
      }

      settled = true;
      if (killTimer) {
        clearTimeout(killTimer);
      }

      handler();
    };

    const killTimer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, timeoutMs)
        : null;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      settle(() => {
        if (quiet) {
          logCommandFailureQuiet(prefix, {
            strategy,
            exitCode: error.errno ?? null,
            stderr,
            stdout,
          });
        } else {
          logCommandFailure(prefix, {
            command: commandLine,
            strategy,
            exitCode: error.errno ?? null,
            stdout,
            stderr,
            error,
          });
        }

        reject(
          new CommandExecutionError(buildFriendlyCommandError(command, strategy, stderr, stdout, error.message), {
            stdout,
            stderr,
            exitCode: error.errno ?? null,
            command: commandLine,
            strategy,
          }),
        );
      });
    });

    child.on('close', (code) => {
      settle(() => {
        if (!quiet) {
          console.log(`${prefix} evento close. codigo de saida: ${code}`);
          console.log(`${prefix} stdout completo:\n${stdout || '(vazio)'}`);
          console.error(`${prefix} stderr completo:\n${stderr || '(vazio)'}`);
        }

        if (timedOut) {
          reject(
            new CommandExecutionError(`Tempo esgotado ao executar ${command}${strategy ? ` (${strategy})` : ''}.`, {
              stdout,
              stderr,
              exitCode: code,
              command: commandLine,
              strategy,
            }),
          );
          return;
        }

        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        if (quiet) {
          logCommandFailureQuiet(prefix, {
            strategy,
            exitCode: code,
            stderr,
            stdout,
          });
        } else {
          logCommandFailure(prefix, {
            command: commandLine,
            strategy,
            exitCode: code,
            stdout,
            stderr,
          });
        }

        reject(
          new CommandExecutionError(buildFriendlyCommandError(command, strategy, stderr, stdout), {
            stdout,
            stderr,
            exitCode: code,
            command: commandLine,
            strategy,
          }),
        );
      });
    });
  });
}

function buildFriendlyCommandError(command, strategy, stderr, stdout, spawnMessage) {
  if (isYouTubeBotError({ message: stderr || stdout, stderr, stdout })) {
    return YOUTUBE_BOT_USER_MESSAGE;
  }

  const summary = summarizeProcessOutput(stderr || stdout);

  if (spawnMessage) {
    return `Falha ao executar ${command}: ${spawnMessage}`;
  }

  const strategyLabel = strategy ? ` (${strategy})` : '';
  const detail = summary ? ` Detalhe: ${summary}` : '';

  return `${command} encerrou com erro${strategyLabel}.${detail}`.trim();
}

function logCommandFailureQuiet(prefix, { strategy, exitCode, stderr, stdout }) {
  console.error(`${prefix} falha (codigo ${exitCode ?? 'desconhecido'})${strategy ? ` — ${strategy}` : ''}`);
  const summary = summarizeProcessOutput(stderr || stdout);

  if (summary) {
    console.error(`${prefix} resumo: ${summary}`);
  }
}

function logCommandFailure(prefix, { command, strategy, exitCode, stdout, stderr, error }) {
  console.error(`${prefix} falha na execucao`);
  console.error(`${prefix} exitCode: ${exitCode ?? '(desconhecido)'}`);
  console.error(`${prefix} comando: ${command}`);
  if (strategy) {
    console.error(`${prefix} estrategia: ${strategy}`);
  }
  if (error) {
    console.error(`${prefix} evento error:`, error);
  }
  console.log(`${prefix} stdout:\n${stdout || '(vazio)'}`);
  console.error(`${prefix} stderr:\n${stderr || '(vazio)'}`);
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArg).join(' ');
}

function quoteArg(arg) {
  const value = String(arg);

  if (/^[\w./:=@%+-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}
