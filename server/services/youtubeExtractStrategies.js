import { getYtDlpCookiesPath } from '../utils/ytDlpCookies.js';

/** Estrategias yt-dlp para contornar bot check em IPs de datacenter (Render, etc.). */
export function getYouTubeExtractStrategies() {
  const strategies = [
    {
      id: 'default',
      label: 'padrao',
      extraArgs: [],
    },
    {
      id: 'android_vr',
      label: 'android_vr',
      extraArgs: ['--extractor-args', 'youtube:player_client=android_vr'],
    },
    {
      id: 'ios',
      label: 'ios',
      extraArgs: ['--extractor-args', 'youtube:player_client=ios,android_vr'],
    },
    {
      id: 'tv_embedded',
      label: 'tv_embedded',
      extraArgs: ['--extractor-args', 'youtube:player_client=tv_embedded,android_vr,ios'],
    },
    {
      id: 'mweb',
      label: 'mweb',
      extraArgs: ['--extractor-args', 'youtube:player_client=mweb,android_vr'],
    },
    {
      id: 'android_tv',
      label: 'android+tv',
      extraArgs: ['--extractor-args', 'youtube:player_client=android,android_vr,tv_embedded'],
    },
  ];

  const cookiesPath = getYtDlpCookiesPath();
  if (cookiesPath) {
    strategies.push({
      id: 'cookies',
      label: 'com cookies',
      extraArgs: ['--cookies', cookiesPath],
    });
    strategies.push({
      id: 'cookies_android_vr',
      label: 'cookies + android_vr',
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
