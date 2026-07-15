# Hello Edge! · Demo de latencia WebSocket

Repositorio ordenado en dos componentes:

- `frontend/`: web que despliega el usuario de la demo.
- `backend/`: eco WebSocket independiente con página de estado y contador de tests.

El navegador compara tres filas: nodo Edge donde se instancia la app, nodo Edge Madrid y Azure. Madrid permanece visible como `No configurado` hasta que exista un endpoint real; ningún nodo de usuario —incluido Coruña— se utiliza como destino predeterminado.

## Qué hacen los instaladores

Hay únicamente dos instaladores raíz. Ambos están preparados para Ubuntu/Debian, deben ejecutarse como `root` y son repetibles: si los contenedores ya existen, los reemplazan por la versión indicada.

- `install-all.sh`: instala Docker si falta, permite los puertos del frontend y backend en UFW, descarga las dos imágenes y despliega frontend + backend en la misma máquina. `REGION` define la fila local `Nodo Edge <REGION>` y el frontend construye la URL local con el hostname público y `BACKEND_PORT`.
- `install-backend.sh`: instala Docker si falta, permite el puerto del backend en UFW, descarga únicamente la imagen backend y despliega el eco WebSocket con su página de estado. El mismo comando sirve para Madrid, Azure o un nodo levantado por un usuario: la ubicación no se configura en el backend, sino en la URL que recibe el frontend.

Los scripts permiten autenticación opcional contra GHCR mediante `REGISTRY_USER` y `REGISTRY_TOKEN`, pero no es necesaria cuando las imágenes son públicas. El grupo de seguridad de OpenStack debe permitir también los puertos publicados; UFW solo configura el firewall de la máquina.

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
- `EDGE_MADRID_WS_URL` — URL completa y puerto del futuro backend de Madrid. Sin valor predeterminado; mientras esté vacía, la fila muestra `No configurado`.
- `AZURE_WS_URL` — URL completa y puerto del backend de Azure. Predeterminado: `ws://158.158.8.244:8080/ws`.
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

El comando es intencionadamente el mismo para cualquier ubicación porque el backend es un eco WebSocket neutro y no necesita conocer si está en Madrid, Azure o un nodo de usuario:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/edgebasico-latencia/main/install-backend.sh \
  | sudo BACKEND_PORT=8080 bash
```

Lo que diferencia cada destino es la URL configurada al desplegar el frontend. Azure ya tiene un valor predeterminado; Madrid queda pendiente:

```bash
# Cuando se despliegue el nodo de Madrid:
EDGE_MADRID_WS_URL=ws://<IP-MADRID>:8080/ws

# Valor predeterminado actual de Azure:
AZURE_WS_URL=ws://158.158.8.244:8080/ws
```

La IP `213.4.160.147` corresponde a Coruña y no se configura como Madrid ni como destino remoto predeterminado. Un usuario puede levantar allí —o en cualquier otra región— su propia instancia con `install-all.sh`; ese despliegue aparecerá como la fila local `Nodo Edge <REGION>`.

Variables:

- `BACKEND_PORT` — puerto público, visible en la página de estado y usado por el frontend en la URL WebSocket. Predeterminado: `8080`.
- `BACKEND_INTERNAL_PORT` — puerto interno. Predeterminado: `8080`.
- `BACKEND_IMAGE` — imagen GHCR del backend.
- `BACKEND_CONTAINER` — nombre del contenedor.
- `REGISTRY_USER` y `REGISTRY_TOKEN` — opcionales para GHCR privado.

Endpoints del backend:

- `/` — página de estado, puerto publicado y contadores.
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

### Publicación y seguridad

Las imágenes no las publica directamente Clovo. Clovo realiza el `push` del código mediante una clave SSH autorizada; después, GitHub Actions construye y publica las imágenes usando un `GITHUB_TOKEN` efímero generado para esa ejecución, limitado a `contents: read` y `packages: write`. No se utiliza ni se almacena un token personal.

Que los packages sean públicos no concede permisos de escritura: cualquier persona puede descargar e inspeccionar las imágenes, pero no sustituirlas. En este proyecto es coherente con que el repositorio y la demo sean públicos y permite que los instaladores funcionen sin credenciales. Los Dockerfiles solo incorporan `src/` y `public/`; `REGISTRY_TOKEN` se entrega a `docker login` por entrada estándar y no se incluye en las imágenes.

El riesgo relevante no es la descarga pública, sino publicar una imagen manipulada bajo `latest` si alguien consigue introducir código en `main` o comprometer una GitHub Action. Conviene proteger la rama `main`, revisar los cambios antes de integrarlos y mantener actualizadas —o fijadas por SHA— las acciones de terceros. Si en el futuro el código o las imágenes contienen componentes privados, los packages deberán pasar a privados y los instaladores requerirán credenciales de solo lectura.
