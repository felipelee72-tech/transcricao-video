# Extracao de texto / transcricao por link

App web pessoal para obter texto a partir de links publicos. O usuario cola uma URL, informa a senha de acesso e acompanha o progresso ate o resultado.

## Modos de operacao

Defina no `.env`:

```env
TRANSCRIPTION_MODE=free-link-text
```

### Modo gratuito por link (`free-link-text`) — padrao

- Apenas link (sem upload de arquivo).
- Nao usa OpenAI nem Supabase Edge Function.
- Nao transcreve audio: extrai textos **ja disponiveis** na plataforma (legendas, captions automaticas, descricao, metadados).
- Usa `yt-dlp` no backend.

**Plataformas:**

| Plataforma | O que o app tenta |
|------------|-------------------|
| **YouTube** | Maior chance de sucesso: legendas manuais, automaticas (pt-BR, pt, depois outros idiomas), descricao |
| **Instagram** | Caption e metadados; legendas so se o extrator retornar algo |
| **TikTok / Facebook** | Caption, metadados e legendas quando acessiveis |
| **Outro link** | Nao suportado no modo gratuito |

Se nao houver legenda ou texto acessivel, o app exibe:

> Não foi encontrada legenda/transcrição acessível para este link. No modo gratuito por link, o app só consegue extrair textos já disponíveis na plataforma.

**Importante:** para transcrever audio real de qualquer link seria necessario API paga (modo `openai`) ou processamento local pesado (ffmpeg + modelo de fala).

### Modo OpenAI (`openai`) — opcional

- Download de audio, `ffmpeg`, chunks no servidor.
- Transcricao via **Supabase Edge Function** (`transcrever`) + OpenAI API.
- Limite: **2 horas** (`MAX_DURATION_MINUTES=120`), blocos de **10 minutos**.
- Links: YouTube ou URL direta de arquivo de audio/video.
- Requer `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e secret `OPENAI_API_KEY` no Supabase.

## Stack

- React + Vite no frontend
- Node.js + Express no backend
- `yt-dlp` (modo gratuito e download no modo OpenAI)
- `ffmpeg` / `ffprobe` (somente modo `openai`)
- Fila simples em memoria
- Protecao por `APP_PASSWORD`

## Requisitos locais

- Node.js 20 ou superior
- `yt-dlp` no PATH (ou copiado automaticamente para `.bin/` na primeira execucao)

**Modo `openai` adicional:**

- `ffmpeg` e `ffprobe`
- Projeto Supabase com Edge Function `transcrever` deployada
- Chave OpenAI como secret no Supabase

## Configuracao

1. Instale as dependencias:

```bash
npm install
```

2. Copie o ambiente:

```powershell
Copy-Item .env.example .env
```

3. Configure o minimo no `.env`:

```env
APP_PASSWORD=your_personal_password_here
TRANSCRIPTION_MODE=free-link-text
```

Para o modo `openai`, adicione tambem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

## Execucao local

```bash
npm run dev
```

URLs padrao:

- Frontend: `http://localhost:5173` (ou proxima porta livre do Vite)
- Backend: `http://localhost:3001`

Servir tudo na porta 3001 (celular na mesma Wi-Fi):

```bash
npm run mobile
```

## Uso pelo celular (mesma Wi-Fi)

1. No PC: `npm run mobile` ou `npm run dev`.
2. Abra no celular a URL exibida (ex.: `http://192.168.x.x:3001` com `npm run mobile`).
3. Informe `APP_PASSWORD` e cole o link (YouTube funciona melhor no modo gratuito).

No modo gratuito, **nao** e necessario configurar Supabase nem OpenAI.

## Resposta da API (modo gratuito)

Resultado em `GET /api/transcriptions/:id`:

```json
{
  "id": "...",
  "success": true,
  "platform": "youtube",
  "sourceType": "auto-caption",
  "text": "...",
  "message": "Texto obtido de legenda automatica (pt-BR)."
}
```

`sourceType`: `subtitle` | `auto-caption` | `caption` | `metadata` | `none`

## Variaveis de ambiente

| Variavel | Descricao |
|----------|-----------|
| `TRANSCRIPTION_MODE` | `free-link-text` (padrao) ou `openai` |
| `APP_PASSWORD` | Senha obrigatoria |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Somente modo `openai` |
| `PORT` | Backend (padrao `3001`) |
| `MAX_DURATION_MINUTES` / `CHUNK_MINUTES` | Somente modo `openai` |
| `YT_DLP_PATH` | Caminho opcional do yt-dlp |

## Fluxo da API

```http
POST /api/transcriptions
Content-Type: application/json
X-App-Password: sua_senha

{ "url": "https://www.youtube.com/watch?v=..." }
```

```http
GET /api/transcriptions/:id/status
GET /api/transcriptions/:id
GET /api/config
```

Endpoints de chunks / `complete` / `fail` existem apenas no modo `openai`.

## Modo OpenAI — Supabase Edge Function

Veja a secao de deploy em `supabase/functions/transcrever/` e use:

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy transcrever
```

## Observacoes

- Uso pessoal com senha; sem login completo.
- **Sem upload de arquivo** pelo usuario em nenhum modo.
- Jobs em memoria: reiniciar o servidor cancela tarefas em andamento.
- O app nao promete transcricao universal no modo gratuito.

## Deploy no Render (acesso publico pelo celular)

O app sobe como **um unico servico web**: o Express usa `process.env.PORT` (definido pelo Render), serve o frontend em `client/dist` e roda o modo `free-link-text` com `yt-dlp` instalado no build.

### 1. Criar repositorio no GitHub

1. Crie um repositorio vazio no GitHub (ex.: `transcricao-video`).
2. **Nao** envie o arquivo `.env` — ele esta no `.gitignore`.

### 2. Subir o codigo (PowerShell)

Na pasta do projeto:

```powershell
cd C:\Projetos\transcricao-video
git init
git add .
git status
git commit -m "Prepare deploy Render (free-link-text)"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/transcricao-video.git
git push -u origin main
```

Revise `git status` antes do commit: **nao** deve listar `.env`, `node_modules` nem `client/dist`.

### 3. Conectar no Render

1. Acesse [https://render.com](https://render.com) e crie conta.
2. **New** → **Blueprint** (se quiser usar `render.yaml`) **ou** **Web Service** manual.
3. Conecte o repositorio GitHub.
4. Se usar Blueprint, o Render le `render.yaml` automaticamente.
5. Se criar manualmente:
   - **Runtime:** Node
   - **Build Command:** `bash scripts/render-build.sh`
   - **Start Command:** `npm run render:start`
   - **Health Check Path:** `/api/health`

### 4. Variaveis de ambiente no Render

No painel **Environment** do servico:

| Variavel | Valor |
|----------|--------|
| `NODE_ENV` | `production` |
| `TRANSCRIPTION_MODE` | `free-link-text` |
| `APP_PASSWORD` | senha forte (obrigatoria) |
| `SERVE_CLIENT` | `true` |
| `ALLOW_LAN_ORIGINS` | `true` |
| `CLIENT_ORIGIN` | URL publica do app (ex.: `https://transcricao-video.onrender.com`) |

Opcional:

| Variavel | Valor |
|----------|--------|
| `DEBUG_YTDLP` | `false` |
| `TRANSCRIPTION_TMP_DIR` | vazio (usa `/tmp` no servidor) |

**Nao** configure `PORT` manualmente — o Render injeta automaticamente.

Apos o primeiro deploy, copie a URL gerada (ex.: `https://transcricao-video.onrender.com`) e defina `CLIENT_ORIGIN` com esse valor exato. Salve e aguarde redeploy.

### 5. Acessar pelo celular

1. Abra a URL publica do Render no navegador do celular.
2. Informe a `APP_PASSWORD` configurada no painel.
3. Cole o link (YouTube funciona melhor).
4. Diagnostico: `https://SUA-URL.onrender.com/debug`

### 6. Testar health

```text
GET https://SUA-URL.onrender.com/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "host": "...",
  "ip": null,
  "mode": "free-link-text",
  "timestamp": "..."
}
```

### Scripts do projeto

| Script | Uso |
|--------|-----|
| `npm run build` | Build do frontend (`client/dist`) |
| `npm start` | Servidor local (com prestart no Windows) |
| `npm run render:build` | Build completo para Render (npm + yt-dlp + client) |
| `npm run render:start` | Start em producao (`node server/index.js`) |
| `npm run mobile` | Local: build + servidor na porta 3001 |

### YouTube bloqueado no Render (bot check)

O app tenta automaticamente:

1. Varias URLs do mesmo video (`watch?v=`, `youtu.be/`)
2. Varios clientes yt-dlp (`android_vr`, `ios`, `tv_embedded`, etc.)
3. API de legendas `timedtext` (sem yt-dlp)

Se ainda falhar, configure no Render a variavel **`YT_DLP_COOKIES_CONTENT`**:

1. No PC, abra YouTube logado no Chrome
2. Instale a extensao **Get cookies.txt LOCALLY**
3. Exporte cookies para `youtube.com` (formato Netscape)
4. Cole o conteudo inteiro em `YT_DLP_COOKIES_CONTENT` no painel Environment do Render
5. Redeploy

Isso nao exige login no app — apenas cookies no servidor.

### Limitacoes no Render (plano free)

- O servico **hiberna** apos inatividade; o primeiro acesso pode demorar ~30s.
- Disco e memoria limitados; jobs ficam em memoria (reinicio apaga fila).
- `yt-dlp` e baixado no build em `.bin/yt-dlp` (Linux).
