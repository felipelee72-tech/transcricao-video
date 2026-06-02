#!/usr/bin/env bash
set -euo pipefail

echo "[render-build] instalando dependencias npm..."
npm install

echo "[render-build] preparando yt-dlp..."
mkdir -p .bin

if command -v yt-dlp >/dev/null 2>&1; then
  YTDLP_PATH="$(command -v yt-dlp)"
  echo "[render-build] yt-dlp no PATH: ${YTDLP_PATH}"
else
  curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o .bin/yt-dlp
  chmod +x .bin/yt-dlp
  echo "[render-build] yt-dlp baixado para .bin/yt-dlp"
fi

echo "[render-build] build do frontend..."
npm run build --workspace client

echo "[render-build] concluido."
