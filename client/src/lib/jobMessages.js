export const YOUTUBE_BOT_CHECK_CODE = 'YOUTUBE_BOT_CHECK';

export const YOUTUBE_BOT_FRONTEND_MESSAGE =
  'O YouTube bloqueou este link no servidor. Tente outro vídeo com legendas públicas. Se o problema persistir, configure YT_DLP_COOKIES_CONTENT no Render (cookies exportados do navegador, formato Netscape).';

export function resolveJobUserMessage(job) {
  if (job?.code === YOUTUBE_BOT_CHECK_CODE) {
    return YOUTUBE_BOT_FRONTEND_MESSAGE;
  }

  return job?.message ?? '';
}
