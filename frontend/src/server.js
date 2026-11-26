const fs = require('fs');
const http = require('http');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 80);
const region = process.env.REGION || process.env.EDGE_REGION || 'Bilbao';
const localBackendPort = Number(process.env.LOCAL_BACKEND_PORT || 8080);
const madridUrl = process.env.EDGE_MADRID_WS_URL || 'ws://213.4.160.121:8080/ws';
const bcnUrl = process.env.EDGE_BCN_WS_URL || 'ws://213.4.161.52:8080/ws';
const awsUrl = process.env.AWS_HTTPS_URL || 'https://ec2.eu-south-2.amazonaws.com/';
function bounded(name,fallback,min,max){const raw=process.env[name];const n=Number(raw);return raw&&Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
const measurement={rounds:bounded('TEST_ROUNDS',500,1,5000),packetSize:bounded('TEST_PACKET_SIZE',64,4,65536),intervalMs:bounded('TEST_INTERVAL_MS',100,50,10000),timeoutMs:bounded('TEST_TIMEOUT_MS',2000,100,30000),warmups:bounded('TEST_WARMUPS',5,0,20),maxConsecutiveFailures:10,httpsRounds:bounded('AWS_TEST_ROUNDS',10,1,20),httpsIntervalMs:bounded('AWS_TEST_INTERVAL_MS',5000,5000,30000)};

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
    });
    response.end(body);
}

function localBackendUrl(request) {
    if (process.env.APP_EDGE_WS_URL) {
        return process.env.APP_EDGE_WS_URL;
    }
    const forwardedHost = request.headers['x-forwarded-host'];
    const hostHeader = Array.isArray(forwardedHost) ? forwardedHost[0] : (forwardedHost || request.headers.host || 'localhost');
    const hostname = hostHeader.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '');
    const forwardedProto = request.headers['x-forwarded-proto'];
    const secure = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) === 'https';
    return `${secure ? 'wss' : 'ws'}://${hostname}:${localBackendPort}/ws`;
}

function safePath(urlPath) {
    const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
    const filePath = path.join(publicDir, normalized || 'index.html');
    return filePath.startsWith(publicDir) ? filePath : null;
}

function serveStatic(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/app-config.json') {
        sendJson(response, 200, {
            region,
            measurement,
            targets: [
                { id: 'app-edge', label: `Nodo Edge ${region}`, url: localBackendUrl(request), type: 'edge', protocol: 'websocket' },
                { id: 'edge-madrid', label: 'Nodo Edge Madrid', url: madridUrl, type: 'edge', protocol: 'websocket' },
                { id: 'edge-bcn', label: 'Nodo Edge Barcelona', url: bcnUrl, type: 'edge', protocol: 'websocket' },
                { id: 'aws', label: 'AWS España', url: awsUrl, type: 'external', protocol: 'https' }
            ]
        });
        return;
    }
    if (requestUrl.pathname === '/client-info.json') {
        const forwardedFor = request.headers['x-forwarded-for'];
        const ip = Array.isArray(forwardedFor)
            ? forwardedFor[0]
            : (forwardedFor || request.socket.remoteAddress || '').split(',')[0].trim();
        sendJson(response, 200, { ip });
        return;
    }

    const filePath = safePath(requestUrl.pathname);
    if (!filePath) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    const resolved = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
        ? path.join(filePath, 'index.html')
        : filePath;
    fs.readFile(resolved, (error, data) => {
        if (error) {
            response.writeHead(404).end('Not found');
            return;
        }
        const extension = path.extname(resolved).toLowerCase();
        response.writeHead(200, {
            'content-type': contentTypes[extension] || 'application/octet-stream',
            'content-length': data.length,
            'cache-control': ['.html', '.css', '.js'].includes(extension) ? 'no-store' : 'public, max-age=300'
        });
        response.end(data);
    });
}

http.createServer(serveStatic).listen(port, '0.0.0.0', () => {
    console.log(`Hello Edge frontend listening on port ${port} for region ${region}`);
});
