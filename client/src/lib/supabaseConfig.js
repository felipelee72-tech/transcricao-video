import { apiUrl } from './api.js';

let cachedConfig = null;

function configFromEnv() {
  const env = import.meta.env ?? {};
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    return {
      supabaseUrl,
      supabaseAnonKey,
      supabaseConfigured: true,
    };
  }

  return null;
}

export async function getSupabaseConfig() {
  const envConfig = configFromEnv();
  if (envConfig) {
    return envConfig;
  }

  if (!cachedConfig) {
    const response = await fetch(apiUrl('/api/config'));
    if (!response.ok) {
      throw new Error('Nao foi possivel carregar a configuracao do Supabase.');
    }

    cachedConfig = await response.json();
  }

  if (!cachedConfig?.supabaseConfigured) {
    throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env');
  }

  return cachedConfig;
}
