import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const projectRef = process.env.SUPABASE_PROJECT_REF || 'utlcsmhtzqhbndqxninf';
const envPath = path.resolve(process.cwd(), '.env');

dotenv.config({ path: envPath });

const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

if (!openAiApiKey) {
  console.error('OPENAI_API_KEY nao encontrada em .env');
  process.exit(1);
}

if (/sua_chav|your_openai|sk-your/i.test(openAiApiKey)) {
  console.error('OPENAI_API_KEY no .env ainda parece placeholder. Cole a chave real antes de continuar.');
  process.exit(1);
}

console.log(`Atualizando secret OPENAI_API_KEY no projeto ${projectRef}...`);

execSync(`npx supabase secrets set OPENAI_API_KEY=${JSON.stringify(openAiApiKey)} --project-ref ${projectRef}`, {
  stdio: 'inherit',
  shell: true,
});

console.log('Secret atualizado. Rode: npx supabase functions deploy transcrever --project-ref', projectRef);
