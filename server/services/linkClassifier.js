const PLATFORM_RULES = [
  { platform: 'youtube', hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'], suffix: '.youtube.com' },
  { platform: 'instagram', hosts: ['instagram.com'], suffix: '.instagram.com' },
  { platform: 'tiktok', hosts: ['tiktok.com', 'vm.tiktok.com'], suffix: '.tiktok.com' },
  { platform: 'facebook', hosts: ['facebook.com', 'fb.watch', 'm.facebook.com'], suffix: '.facebook.com' },
];

export function classifyLinkPlatform(inputUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(inputUrl);
  } catch {
    throw new Error('Informe uma URL valida.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('A URL precisa usar HTTP ou HTTPS.');
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  for (const rule of PLATFORM_RULES) {
    if (
      rule.hosts.includes(hostname) ||
      hostname.endsWith(rule.suffix) ||
      rule.hosts.some((host) => hostname.endsWith(`.${host}`))
    ) {
      return {
        platform: rule.platform,
        url: parsedUrl.toString(),
        hostname,
      };
    }
  }

  return {
    platform: 'unsupported',
    url: parsedUrl.toString(),
    hostname,
  };
}

export function normalizeYouTubeUrl(inputUrl) {
  const parsedUrl = new URL(inputUrl);
  const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

  if (hostname === 'youtu.be') {
    const videoId = parsedUrl.pathname.slice(1).split('/')[0];
    if (!videoId) {
      throw new Error('URL do YouTube invalida.');
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (hostname.includes('youtube.com')) {
    const videoId = parsedUrl.searchParams.get('v');
    if (!videoId) {
      throw new Error('URL do YouTube invalida.');
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  return inputUrl;
}
