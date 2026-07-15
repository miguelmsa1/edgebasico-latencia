#!/usr/bin/env bash
set -euo pipefail

# Identificador visible en la página de estado. Ejemplos: "Nodo Edge Madrid", "Azure".
BACKEND_NAME="${BACKEND_NAME:-Backend de latencia}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/miguelmsa1/edgebasico-latencia-backend:latest}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
BACKEND_INTERNAL_PORT="${BACKEND_INTERNAL_PORT:-8080}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-hello-edge-backend}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este instalador como root (sudo)." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Este instalador requiere Ubuntu/Debian con apt-get." >&2
  exit 1
fi

install_docker() {
  if command -v docker >/dev/null 2>&1; then return; fi
  apt-get update
  apt-get install -y ca-certificates curl gnupg ufw
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

install_docker
command -v ufw >/dev/null 2>&1 || { apt-get update && apt-get install -y ufw; }
ufw allow OpenSSH
ufw allow "${BACKEND_PORT}/tcp"
ufw --force enable

if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ]; then
  echo "${REGISTRY_TOKEN}" | docker login ghcr.io -u "${REGISTRY_USER}" --password-stdin
fi

docker pull "${BACKEND_IMAGE}"
docker rm -f "${BACKEND_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${BACKEND_CONTAINER}" \
  --restart unless-stopped \
  -p "${BACKEND_PORT}:${BACKEND_INTERNAL_PORT}" \
  -e BACKEND_PORT="${BACKEND_INTERNAL_PORT}" \
  -e BACKEND_NAME="${BACKEND_NAME}" \
  "${BACKEND_IMAGE}"

echo
echo "${BACKEND_NAME} desplegado correctamente."
echo "Estado: http://<IP>:${BACKEND_PORT}/"
echo "Health: http://<IP>:${BACKEND_PORT}/healthz"
echo "WebSocket: ws://<IP>:${BACKEND_PORT}/ws"
