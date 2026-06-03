import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractYtInitialPlayerResponse,
  parseJsonObjectFrom,
} from './youtubeWatchCaptions.js';

test('parseJsonObjectFrom extrai objeto balanceado', () => {
  const payload = { captions: { ok: true } };
  const text = `prefix ${JSON.stringify(payload)} suffix`;
  const start = text.indexOf('{');

  assert.deepEqual(parseJsonObjectFrom(text, start), payload);
});

test('extractYtInitialPlayerResponse le captionTracks', () => {
  const player = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode: 'en',
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
          },
        ],
      },
    },
  };

  const html = `<script>ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`;
  const extracted = extractYtInitialPlayerResponse(html);

  assert.equal(
    extracted.captions.playerCaptionsTracklistRenderer.captionTracks.length,
    1,
  );
});
