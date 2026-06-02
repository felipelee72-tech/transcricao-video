const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VITE_DEV_PORTS = new Set(['5173', '5174', '5175', '5176']);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname).toLowerCase());
}

function isEmbeddedLocalUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const { hostname } = new URL(url);
    return isLoopbackHost(hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(url);
  }
}

function isViteDevPort(port) {
  return VITE_DEV_PORTS.has(String(port));
}

/**
 * Base da API. String vazia = URLs relativas (mesmo host da pagina).
 * Evita localhost/127.0.0.1 embutidos no celular.
 */
export function getApiBaseUrl() {
  if (typeof window === 'undefined') {
    return '';
  }

  const { hostname, protocol, port } = window.location;

  if (port === '3001' || port === '' || port === '80' || port === '443') {
    return '';
  }

  const configured = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL;
  if (configured && !isEmbeddedLocalUrl(configured) && !isLoopbackHost(hostname)) {
    return configured.replace(/\/$/, '');
  }

  if (isViteDevPort(port) && isLoopbackHost(hostname)) {
    return '';
  }

  return `${protocol}//${hostname}:3001`;
}

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getClientDiagnostics() {
  if (typeof window === 'undefined') {
    return {};
  }

  return {
    href: window.location.href,
    origin: window.location.origin,
    hostname: window.location.hostname,
    port: window.location.port,
    apiBaseUrl: getApiBaseUrl() || '(relativo — mesmo host da pagina)',
    resolvedApiHealthUrl: apiUrl('/api/health'),
  };
}
