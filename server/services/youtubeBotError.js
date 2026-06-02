export const YOUTUBE_BOT_CHECK_CODE = 'YOUTUBE_BOT_CHECK';

export const YOUTUBE_BOT_USER_MESSAGE =
  'O YouTube bloqueou a extração automática neste servidor. Tente outro vídeo ou use um vídeo com legenda acessível publicamente.';

const BOT_PATTERNS = [
  /sign in to confirm/i,
  /confirm you.?re not a bot/i,
  /not a bot/i,
  /cookies-from-browser/i,
  /unable to extract.*youtube/i,
];

export function isYouTubeBotError(error) {
  const text = collectErrorText(error);
  return BOT_PATTERNS.some((pattern) => pattern.test(text));
}

export function collectErrorText(error) {
  if (!error) {
    return '';
  }

  const stderr = error.stderr ?? '';
  const stdout = error.stdout ?? '';

  if (stderr || stdout) {
    return [error.message, stderr, stdout].filter(Boolean).join('\n');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function buildYouTubeBotCheckResult(platform = 'youtube') {
  return {
    success: false,
    platform,
    sourceType: 'none',
    text: '',
    code: YOUTUBE_BOT_CHECK_CODE,
    message: YOUTUBE_BOT_USER_MESSAGE,
  };
}
