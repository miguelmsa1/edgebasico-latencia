# Hello Edge! · Demo de latencia WebSocket

Repositorio ordenado en dos componentes:

- `frontend/`: web que despliega el usuario de la demo.
- `backend/`: eco WebSocket independiente con página de estado y contador de tests.

El navegador abre directamente tres conexiones: nodo Edge donde se instancia la app, nodo Edge Madrid y Azure.

## Instaladores de un solo comando

Hay únicamente dos instaladores raíz:

- `install-all.sh`: despliega frontend y backend en la misma máquina.
- `install-backend.sh`: despliega solo el backend, pensado para Madrid, Azure u otro destino remoto.

### 1. Frontend + backend

`REGION` es obligatoria y determina tanto el texto de la web como la fila local de la tabla: `Nodo Edge <REGION>`.

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/edgebasico-latencia/main/install-all.sh \
  | sudo REGION=Bilbao BACKEND_PORT=8080 bash
```

Variables:

- `REGION` — **obligatoria**. Ubicación del despliegue: `Bilbao`, `Sevilla`, etc.
- `FRONTEND_PORT` — puerto HTTP del frontend. Predeterminado: `80`.
- `BACKEND_PORT` — puerto público del backend local. Predeterminado: `8080`.
- `BACKEND_INTERNAL_PORT` — puerto interno del contenedor backend. Predeterminado: `8080`.
- `APP_EDGE_WS_URL` — URL WebSocket completa del backend local. Si se omite, el navegador usa el hostname del frontend y `BACKEND_PORT`.
- `EDGE_MADRID_WS_URL` — predeterminado: `ws://213.4.160.147/ws`.
- `AZURE_WS_URL` — predeterminado: `ws://68.221.73.138/ws`.
- `FRONTEND_IMAGE` — predeterminado: `ghcr.io/miguelmsa1/edgebasico-latencia-frontend:latest`.
- `BACKEND_IMAGE` — predeterminado: `ghcr.io/miguelmsa1/edgebasico-latencia-backend:latest`.
- `FRONTEND_CONTAINER` / `BACKEND_CONTAINER` — nombres de los contenedores.
- `REGISTRY_USER` y `REGISTRY_TOKEN` — opcionales si los packages GHCR no son públicos.

Ejemplo con URL local explícita:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/edgebasico-latencia/main/install-all.sh \
  | sudo REGION=Bilbao \
      FRONTEND_PORT=80 \
      BACKEND_PORT=8080 \
      APP_EDGE_WS_URL=ws://213.4.160.218:8080/ws \
      bash
```

### 2. Solo backend

Madrid:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/edgebasico-latencia/main/install-backend.sh \
  | sudo BACKEND_NAME="Nodo Edge Madrid" BACKEND_PORT=80 bash
```

Azure:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/edgebasico-latencia/main/install-backend.sh \
  | sudo BACKEND_NAME="Azure" BACKEND_PORT=80 bash
```

Variables:

- `BACKEND_NAME` — nombre visible en la página de estado.
- `BACKEND_PORT` — puerto público. Predeterminado: `8080`.
- `BACKEND_INTERNAL_PORT` — puerto interno. Predeterminado: `8080`.
- `BACKEND_IMAGE` — imagen GHCR del backend.
- `BACKEND_CONTAINER` — nombre del contenedor.
- `REGISTRY_USER` y `REGISTRY_TOKEN` — opcionales para GHCR privado.

Endpoints del backend:

- `/` — página de estado y contadores.
- `/healthz` — health check JSON.
- `/stats.json` — estadísticas JSON.
- `/ws` — eco WebSocket.

## Docker Compose local

```bash
REGION=Bilbao FRONTEND_PORT=80 BACKEND_PORT=8080 docker compose up -d --build
```

## Frontend

El frontend muestra:

- IP detectada.
- Ubicación / operador.
- Mediana de 64 B del nodo local.
- Ubicación más rápida.
- Tabla con `Nodo Edge <REGION>`, `Nodo Edge Madrid` y `Azure`.
- Columnas: mediana, vs. más rápido, min/max y jitter.

El texto `$$region$$` se sustituye en runtime por `REGION` mediante `/app-config.json`.

## Método de medición

Por cada destino se descartan 5 rondas de calentamiento y se realizan 50 rondas útiles con mensajes de 64 B. El navegador mide mediante `performance.now()` el tiempo entre `socket.send()` y la recepción del eco.

Es RTT de aplicación WebSocket observado por el navegador; no es ICMP ni una prueba de MTU/DF. Si el frontend usa HTTPS, los backends deben exponerse mediante `wss://`.

## GitHub Actions y GHCR

`.github/workflows/publish-images.yml` ejecuta en cada push a `main`:

1. Validación de JavaScript, instaladores y Compose.
2. Construcción independiente de `frontend/` y `backend/`.
3. Publicación de:
   - `ghcr.io/miguelmsa1/edgebasico-latencia-frontend:latest`
   - `ghcr.io/miguelmsa1/edgebasico-latencia-backend:latest`
4. Publicación adicional de una etiqueta con el SHA del commit.

No requiere un token personal: utiliza `GITHUB_TOKEN` con permiso `packages: write`. Para que los instaladores funcionen sin credenciales, ambos packages deben quedar públicos en GHCR.
