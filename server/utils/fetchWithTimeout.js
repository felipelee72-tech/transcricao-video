/**
 * fetch com limite de tempo (evita jobs presos em rede lenta).
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
