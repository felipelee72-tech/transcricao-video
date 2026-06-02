export function formatTranscriptionError(error, { freeLinkMode = false } = {}) {
  const message = error instanceof Error ? error.message : String(error);

  if (freeLinkMode) {
    return message;
  }

  if (/sua_chav|placeholder|OPENAI_API_KEY no Supabase/i.test(message)) {
    return 'Chave OpenAI invalida no Supabase. Rode: npx supabase login && npm run supabase:sync-openai-key';
  }

  if (/429|quota|exceeded your current quota/i.test(message)) {
    return 'Cota da OpenAI esgotada. Adicione creditos em platform.openai.com/settings/billing e tente novamente.';
  }

  if (/401|Incorrect API key/i.test(message)) {
    return 'Chave OpenAI rejeitada. Atualize o secret no Supabase com npm run supabase:sync-openai-key';
  }

  return message;
}
