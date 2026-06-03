import { getYtDlpCookiesPath } from '../utils/ytDlpCookies.js';

/** Estrategias yt-dlp (poucas — evita timeout no Render). */
export function getYouTubeExtractStrategies() {
  const strategies = [
    {
      id: 'android_vr',
      label: 'android_vr',
      extraArgs: ['--extractor-args', 'youtube:player_client=android_vr,ios'],
    },
    {
      id: 'default',
      label: 'padrao',
      extraArgs: [],
    },
  ];

  const cookiesPath = getYtDlpCookiesPath();
  if (cookiesPath) {
    strategies.push({
      id: 'cookies',
      label: 'com cookies',
      extraArgs: [
        '--cookies',
        cookiesPath,
        '--extractor-args',
        'youtube:player_client=android_vr,ios,tv_embedded',
      ],
    });
  }

  return strategies;
}
