import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandExecutionError } from '../utils/process.js';
import { getYouTubeUrlVariants } from './linkClassifier.js';
import { isYouTubeBotError, YOUTUBE_BOT_CHECK_CODE, buildYouTubeBotCheckResult } from './youtubeBotError.js';

test('detecta erro de bot do YouTube', () => {
  const error = new CommandExecutionError('yt-dlp failed', {
    stderr: 'ERROR: Sign in to confirm you’re not a bot',
    stdout: '',
  });

  assert.equal(isYouTubeBotError(error), true);
});

test('variantes de URL do YouTube', () => {
  const variants = getYouTubeUrlVariants(
    'https://www.youtube.com/watch?v=abc123&t=10&list=PLxxx',
  );

  assert.deepEqual(variants, [
    'https://www.youtube.com/watch?v=abc123',
    'https://www.youtube.com/watch?v=abc123&t=10&list=PLxxx',
    'https://youtu.be/abc123',
  ]);
});

test('resultado YOUTUBE_BOT_CHECK', () => {
  const result = buildYouTubeBotCheckResult();
  assert.equal(result.success, false);
  assert.equal(result.code, YOUTUBE_BOT_CHECK_CODE);
  assert.match(result.message, /bloqueou a extração automática/i);
});
