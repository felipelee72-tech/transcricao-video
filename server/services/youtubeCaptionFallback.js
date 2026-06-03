import { fetchYouTubeTimedTextCaptions } from './youtubeTimedText.js';
import {
  fetchYouTubeWatchPageCaptions,
  fetchYouTubeWatchPageMetadata,
} from './youtubeWatchCaptions.js';

/**
 * Extrai texto sem yt-dlp: legendas (pagina/API) e, se necessario, titulo/descricao.
 */
export async function fetchYouTubeCaptionsWithoutYtDlp(videoId) {
  const watch = await fetchYouTubeWatchPageCaptions(videoId);
  if (watch?.text) {
    return { ...watch, method: 'watch-page' };
  }

  const timed = await fetchYouTubeTimedTextCaptions(videoId);
  if (timed?.text) {
    return { ...timed, method: 'timedtext' };
  }

  const metadata = await fetchYouTubeWatchPageMetadata(videoId);
  if (metadata?.text) {
    return { ...metadata, method: 'watch-metadata' };
  }

  return null;
}
