#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT_DIR}/.bin"
YTDLP_BIN="${BIN_DIR}/yt-dlp"

install_yt_dlp() {
  echo "[render-build] instalando yt-dlp (sempre baixa a release mais recente)..."
  rm -f "${YTDLP_BIN}" "${BIN_DIR}/yt-dlp.version" "${BIN_DIR}/yt-dlp.release"
  mkdir -p "${BIN_DIR}"

  RELEASE_TAG="latest"
  DOWNLOAD_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"

  if command -v curl >/dev/null 2>&1; then
    RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" || true)"
    if [ -n "${RELEASE_JSON}" ]; then
      PARSED_TAG="$(printf '%s' "${RELEASE_JSON}" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
      if [ -n "${PARSED_TAG}" ]; then
        RELEASE_TAG="${PARSED_TAG}"
        DOWNLOAD_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${RELEASE_TAG}/yt-dlp"
      fi
    fi
  fi

  echo "[render-build] release alvo: ${RELEASE_TAG}"
  echo "[render-build] URL: ${DOWNLOAD_URL}"

  curl -fsSL "${DOWNLOAD_URL}" -o "${YTDLP_BIN}"
  chmod +x "${YTDLP_BIN}"

  VERSION="$("${YTDLP_BIN}" --version 2>/dev/null | head -n 1 || echo unknown)"
  printf '%s\n' "${VERSION}" > "${BIN_DIR}/yt-dlp.version"
  printf '%s\n' "${RELEASE_TAG}" > "${BIN_DIR}/yt-dlp.release"

  echo "[render-build] yt-dlp instalado: ${VERSION} (tag ${RELEASE_TAG})"
  echo "[render-build] binario: ${YTDLP_BIN}"
  ls -la "${YTDLP_BIN}"
}

echo "[render-build] instalando dependencias npm..."
cd "${ROOT_DIR}"
npm install

install_yt_dlp

echo "[render-build] build do frontend..."
npm run build --workspace client

echo "[render-build] concluido."
