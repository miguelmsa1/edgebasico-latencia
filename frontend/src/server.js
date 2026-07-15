const fs = require('fs');
const http = require('http');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 80);
const region = process.env.REGION || process.env.EDGE_REGION || 'Bilbao';
const localBackendPort = Number(process.env.LOCAL_BACKEND_PORT || 8080);
const madridUrl = process.env.EDGE_MADRID_WS_URL || 'ws://213.4.160.147:8080/ws';
const azureUrl = process.env.AZURE_WS_URL || 'ws://68.221.73.138:8080/ws';

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
            targets: [
                { id: 'app-edge', label: `Nodo Edge ${region}`, url: localBackendUrl(request), type: 'edge' },
                { id: 'edge-madrid', label: 'Nodo Edge Madrid', url: madridUrl, type: 'edge' },
                { id: 'azure', label: 'Azure', url: azureUrl, type: 'external' }
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
            'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=300'
        });
        response.end(data);
    });
}

http.createServer(serveStatic).listen(port, '0.0.0.0', () => {
    console.log(`Hello Edge frontend listening on port ${port} for region ${region}`);
});
