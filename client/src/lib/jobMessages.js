export const YOUTUBE_BOT_CHECK_CODE = 'YOUTUBE_BOT_CHECK';

export const YOUTUBE_BOT_FRONTEND_MESSAGE =
  'Este vídeo foi bloqueado pelo YouTube para extração automática no servidor hospedado. O app está funcionando, mas este link não pode ser extraído pelo Render.';

export function resolveJobUserMessage(job) {
  if (job?.code === YOUTUBE_BOT_CHECK_CODE) {
    return YOUTUBE_BOT_FRONTEND_MESSAGE;
  }

  return job?.message ?? '';
}
