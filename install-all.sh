#!/usr/bin/env bash
set -euo pipefail

# REQUIRED
REGION="${REGION:-}"

# Images published by GitHub Actions
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.io/miguelmsa1/edgebasico-latencia-frontend:latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-ghcr.io/miguelmsa1/edgebasico-latencia-backend:latest}"

# Local deployment
FRONTEND_PORT="${FRONTEND_PORT:-80}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
BACKEND_INTERNAL_PORT="${BACKEND_INTERNAL_PORT:-8080}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-hello-edge-frontend}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-hello-edge-backend}"

# Target URLs shown by the frontend
APP_EDGE_WS_URL="${APP_EDGE_WS_URL:-}"
EDGE_MADRID_WS_URL="${EDGE_MADRID_WS_URL:-}"
AZURE_WS_URL="${AZURE_WS_URL:-ws://68.221.73.138:8080/ws}"

if [ -z "${REGION}" ]; then
  echo "ERROR: REGION es obligatoria. Ejemplo: REGION=Bilbao" >&2
  exit 1
fi
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
ufw allow "${FRONTEND_PORT}/tcp"
ufw allow "${BACKEND_PORT}/tcp"
ufw --force enable

if [ -n "${REGISTRY_USER:-}" ] && [ -n "${REGISTRY_TOKEN:-}" ]; then
  echo "${REGISTRY_TOKEN}" | docker login ghcr.io -u "${REGISTRY_USER}" --password-stdin
fi

docker pull "${BACKEND_IMAGE}"
docker pull "${FRONTEND_IMAGE}"
docker rm -f "${BACKEND_CONTAINER}" "${FRONTEND_CONTAINER}" >/dev/null 2>&1 || true

docker run -d \
  --name "${BACKEND_CONTAINER}" \
  --restart unless-stopped \
  -p "${BACKEND_PORT}:${BACKEND_INTERNAL_PORT}" \
  -e BACKEND_PORT="${BACKEND_INTERNAL_PORT}" \
  -e PUBLIC_BACKEND_PORT="${BACKEND_PORT}" \
  "${BACKEND_IMAGE}"

docker run -d \
  --name "${FRONTEND_CONTAINER}" \
  --restart unless-stopped \
  -p "${FRONTEND_PORT}:80" \
  -e REGION="${REGION}" \
  -e LOCAL_BACKEND_PORT="${BACKEND_PORT}" \
  -e APP_EDGE_WS_URL="${APP_EDGE_WS_URL}" \
  -e EDGE_MADRID_WS_URL="${EDGE_MADRID_WS_URL}" \
  -e AZURE_WS_URL="${AZURE_WS_URL}" \
  "${FRONTEND_IMAGE}"

echo
echo "Hello Edge desplegado correctamente."
echo "Región/fila local: Nodo Edge ${REGION}"
echo "Frontend: http://<IP>:${FRONTEND_PORT}/"
echo "Backend: http://<IP>:${BACKEND_PORT}/"
echo "WebSocket local: ${APP_EDGE_WS_URL:-ws://<IP>:${BACKEND_PORT}/ws}"
echo "Madrid: ${EDGE_MADRID_WS_URL:-pendiente de configurar}"
echo "Azure: ${AZURE_WS_URL}"
