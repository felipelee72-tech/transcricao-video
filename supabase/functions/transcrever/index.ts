import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (request) => {
  console.log('[transcrever] request', {
    method: request.method,
    contentType: request.headers.get('content-type') ?? '(ausente)',
    hasOpenAiKey: Boolean(Deno.env.get('OPENAI_API_KEY')),
  });

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Metodo nao permitido.' }, 405);
  }

  try {
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiApiKey) {
      return jsonResponse({ error: 'OPENAI_API_KEY nao configurada na Edge Function.' }, 500);
    }

    if (/sua_chav|your_openai|sk-your/i.test(openAiApiKey)) {
      return jsonResponse(
        {
          error:
            'OPENAI_API_KEY no Supabase ainda e um placeholder. Rode: npm run supabase:sync-openai-key',
        },
        500,
      );
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonResponse({ error: 'Envie multipart/form-data com campo file.' }, 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');

    console.log('[transcrever] body', {
      bodyType: 'multipart/form-data',
      fileIsFile: file instanceof File,
      fileSize: file instanceof File ? file.size : null,
      fileName: file instanceof File ? file.name : null,
    });

    if (!(file instanceof File)) {
      return jsonResponse({ error: 'Campo file obrigatorio.' }, 400);
    }

    if (file.size === 0) {
      return jsonResponse({ error: 'Arquivo vazio.' }, 400);
    }

    const model = Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') ?? 'gpt-4o-mini-transcribe';
    const openAiForm = new FormData();
    openAiForm.append('file', file, file.name || 'audio.mp3');
    openAiForm.append('model', model);
    openAiForm.append('response_format', 'text');

    const openAiResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: openAiForm,
    });

    if (!openAiResponse.ok) {
      const errorBody = await openAiResponse.text();
      console.error('[transcrever] openai error', {
        status: openAiResponse.status,
        body: errorBody,
      });
      return jsonResponse(
        { error: `OpenAI retornou ${openAiResponse.status}: ${errorBody}` },
        openAiResponse.status,
      );
    }

    const text = (await openAiResponse.text()).trim();
    console.log('[transcrever] success', { textLength: text.length });
    return jsonResponse({ text }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado na transcricao.';
    console.error('[transcrever] unexpected error', { message });
    return jsonResponse({ error: message }, 500);
  }
});

function jsonResponse(body: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
