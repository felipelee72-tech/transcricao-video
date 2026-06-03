export const YOUTUBE_BOT_CHECK_CODE = 'YOUTUBE_BOT_CHECK';

export const YOUTUBE_BOT_FRONTEND_MESSAGE =
  'O YouTube bloqueou a extracao de legendas neste servidor (comum no Render). Tente outro video com legendas publicas ou configure YT_DLP_COOKIES_CONTENT no Render: exporte cookies do youtube.com no Chrome (extensao Get cookies.txt LOCALLY, formato Netscape) e cole no Environment. Reinicie o servico apos salvar.';

export function resolveJobUserMessage(job) {
  if (job?.code === YOUTUBE_BOT_CHECK_CODE) {
    return YOUTUBE_BOT_FRONTEND_MESSAGE;
  }

  return job?.message ?? '';
}
