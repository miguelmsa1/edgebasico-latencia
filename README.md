# Smart Edge WebSocket Latency Demo

Variante publica de la demo para medir RTT de aplicacion desde navegador mediante WebSocket.

La app:

- Sirve HTML/CSS/JS desde un backend Node.js.
- Expone WebSocket en `/ws`.
- Mide payloads binarios de 64, 512 y 1472 bytes.
- Ejecuta 5 rondas de calentamiento descartadas y 50 rondas utiles por payload.
- Muestra comparativa contra varios destinos WebSocket desde la misma pagina.
- Muestra por defecto Edge Bilbao, Edge Galicia, Edge Barcelona, Edge Sevilla y Azure como referencia externa.
- Muestra mediana media, minimo medio, maximo medio, jitter medio, diferencia frente al destino mas rapido y muestras validas.
- Mantiene `EDGE_REGION` configurable por variable de entorno.

## Levantar con Docker Compose

```bash
docker compose up -d --build
```

## Despliegue en una VM con un unico comando

El fichero `install-and-run.sh` prepara una VM Ubuntu, instala Docker, abre SSH y el puerto HTTP elegido en UFW, descarga la imagen Docker publicada y arranca el contenedor con la configuracion de targets.

Uso recomendado para la instancia principal de Bilbao:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/smartedge-websocket-latency/main/install-and-run.sh | sudo EDGE_REGION=Bilbao \
  EDGE_GALICIA_WS_URL=ws://IP_O_DNS_EDGE_GALICIA/ws \
  EDGE_BARCELONA_WS_URL=ws://IP_O_DNS_EDGE_BARCELONA/ws \
  EDGE_SEVILLA_WS_URL=ws://IP_O_DNS_EDGE_SEVILLA/ws \
  AZURE_WS_URL=ws://IP_O_DNS_AZURE/ws \
  bash
```

Uso recomendado para nodos destino, incluida Azure, si solo deben responder al eco WebSocket:

```bash
curl -fsSL https://raw.githubusercontent.com/miguelmsa1/smartedge-websocket-latency/main/install-and-run.sh | sudo EDGE_REGION=Azure bash
```

La imagen esperada por defecto es `ghcr.io/miguelmsa1/smartedge-websocket-latency:latest`. Si se publica con otro nombre, usa `IMAGE_REF=...` en el comando.

Variables utiles:

```bash
EDGE_REGION=Bilbao HOST_PORT=80 docker compose up -d --build
```

Para que la web central compare contra otros nodos Edge y Azure, despliega esta misma app en cada backend y configura en la instancia principal las URL WebSocket publicas:

```bash
EDGE_REGION=Bilbao \
EDGE_GALICIA_WS_URL=ws://IP_O_DNS_EDGE_GALICIA/ws \
EDGE_BARCELONA_WS_URL=ws://IP_O_DNS_EDGE_BARCELONA/ws \
EDGE_SEVILLA_WS_URL=ws://IP_O_DNS_EDGE_SEVILLA/ws \
AZURE_WS_URL=ws://IP_O_DNS_AZURE/ws \
docker compose up -d --build
```

AWS y GCP siguen soportados en la configuracion, pero quedan ocultos por defecto en la tabla. Para volver a mostrarlos, configura `AWS_WS_URL`/`GCP_WS_URL` y lanza la instancia principal con `SHOW_HIDDEN_HYPERSCALERS=true`.

Si la web principal se sirve por HTTPS, las URL remotas deben ser `wss://.../ws`; los navegadores suelen bloquear WebSocket inseguro `ws://` desde una pagina HTTPS.

En las VMs o nodos remotos puedes levantar la misma app sin configurar targets adicionales: solo necesitan exponer `/ws` hacia Internet.

En Linux, si quieres reducir la diferencia frente a ICMP eliminando la capa de publicacion/NAT de Docker, puedes levantar la variante con red host:

```bash
docker compose -f docker-compose.host.yml up -d --build
```

Esta variante publica directamente el proceso Node en el puerto 80 del host. No usa `HOST_PORT`; si el puerto 80 ya esta ocupado, hay que parar el servicio que lo use o cambiar `PORT`.

## Metodologia

El navegador abre conexiones WebSocket en paralelo contra Edge Bilbao, que es el servidor que sirve la pagina, y contra cada backend configurado en `EDGE_GALICIA_WS_URL`, `EDGE_BARCELONA_WS_URL`, `EDGE_SEVILLA_WS_URL` y `AZURE_WS_URL`. Para cada destino y payload, ejecuta 5 rondas de calentamiento descartadas y despues envia 50 mensajes binarios, midiendo el tiempo entre `socket.send(...)` y la recepcion del eco del servidor con `performance.now()`.

Esta prueba es defendible como RTT de aplicacion desde navegador a servidor. No es ICMP, no genera Echo Request y no permite fijar DF=1, por lo que no valida MTU real del camino.

Ten en cuenta que un `ping` a la IP publica del host mide ICMP contra la pila de red del sistema operativo. Esta demo mide aplicacion: navegador, WebSocket, proceso Node.js y, con el `docker-compose.yml` normal, tambien la publicacion/NAT de Docker. Para comparar contra ICMP con el menor ruido posible, usa `docker-compose.host.yml` en Linux.

Para comparar Smart Edge contra Azure de forma homogenea, despliega esta misma app en una VM equivalente y configura su URL WebSocket en la instancia principal. Evita mezclar esta medicion con Blob Storage, CDN, API Gateway, App Service, Cloud Run u otros PaaS si quieres una comparativa IaaS limpia.
