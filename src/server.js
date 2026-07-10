const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT || 80);
const edgeRegion = process.env.EDGE_REGION || 'Bilbao';
const showHiddenHyperscalers = process.env.SHOW_HIDDEN_HYPERSCALERS === 'true';
const targetEnv = [
    { id: 'edge-galicia', label: process.env.EDGE_GALICIA_LABEL || 'Edge Galicia', url: process.env.EDGE_GALICIA_WS_URL, type: 'edge' },
    { id: 'edge-barcelona', label: process.env.EDGE_BARCELONA_LABEL || 'Edge Barcelona', url: process.env.EDGE_BARCELONA_WS_URL, type: 'edge' },
    { id: 'edge-sevilla', label: process.env.EDGE_SEVILLA_LABEL || 'Edge Sevilla', url: process.env.EDGE_SEVILLA_WS_URL, type: 'edge' },
    { id: 'azure', label: process.env.AZURE_LABEL || 'Azure', url: process.env.AZURE_WS_URL, type: 'external' },
    { id: 'aws', label: process.env.AWS_LABEL || 'AWS', url: process.env.AWS_WS_URL, type: 'external', hidden: true },
    { id: 'gcp', label: process.env.GCP_LABEL || 'GCP', url: process.env.GCP_WS_URL, type: 'external', hidden: true }
];

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

function configuredTargets() {
    return targetEnv
        .filter((target) => !target.hidden || showHiddenHyperscalers)
        .map((target) => ({
            id: target.id,
            label: target.label,
            url: target.url || null,
            type: target.type,
            configured: Boolean(target.url)
        }));
}

function safePath(urlPath) {
    const normalizedPath = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
    const filePath = path.join(publicDir, normalizedPath || 'index.html');
    if (!filePath.startsWith(publicDir)) {
        return null;
    }
    return filePath;
}

function serveStatic(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/edge-config.json') {
        sendJson(response, 200, { region: edgeRegion });
        return;
    }
    if (requestUrl.pathname === '/app-config.json') {
        sendJson(response, 200, {
            region: edgeRegion,
            targets: configuredTargets()
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
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    const resolvedPath = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
        ? path.join(filePath, 'index.html')
        : filePath;

    fs.readFile(resolvedPath, (error, data) => {
        if (error) {
            fs.readFile(path.join(publicDir, 'index.html'), (fallbackError, fallbackData) => {
                if (fallbackError) {
                    response.writeHead(404);
                    response.end('Not found');
                    return;
                }
                response.writeHead(200, {
                    'content-type': contentTypes['.html'],
                    'content-length': fallbackData.length,
                    'cache-control': 'no-store'
                });
                response.end(fallbackData);
            });
            return;
        }

        const extension = path.extname(resolvedPath).toLowerCase();
        response.writeHead(200, {
            'content-type': contentTypes[extension] || 'application/octet-stream',
            'content-length': data.length,
            'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=300'
        });
        response.end(data);
    });
}

function websocketAcceptKey(key) {
    return crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
}

function encodeFrame(payload, opcode = 2) {
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (payloadBuffer.length < 126) {
        header = Buffer.from([0x80 | opcode, payloadBuffer.length]);
    } else if (payloadBuffer.length <= 0xffff) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(payloadBuffer.length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(payloadBuffer.length), 2);
    }
    return Buffer.concat([header, payloadBuffer]);
}

function tryReadFrame(buffer) {
    if (buffer.length < 2) {
        return null;
    }
    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;
    if (!fin) {
        throw new Error('Fragmented WebSocket frames are not supported');
    }
    if (payloadLength === 126) {
        if (buffer.length < offset + 2) {
            return null;
        }
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) {
            return null;
        }
        const bigLength = buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error('WebSocket frame too large');
        }
        payloadLength = Number(bigLength);
        offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = offset + maskLength + payloadLength;
    if (buffer.length < frameLength) {
        return null;
    }

    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
    if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
            payload[index] ^= mask[index % 4];
        }
    }
    return { frame: { opcode, payload }, remaining: buffer.subarray(frameLength) };
}

function handleWebSocket(request, socket) {
    const key = request.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }
    socket.setNoDelay(true);
    socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + websocketAcceptKey(key),
        '',
        ''
    ].join('\r\n'));

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
            while (buffer.length) {
                const parsed = tryReadFrame(buffer);
                if (!parsed) {
                    break;
                }
                buffer = parsed.remaining;
                const { opcode, payload } = parsed.frame;
                if (opcode === 0x8) {
                    socket.end(encodeFrame(Buffer.alloc(0), 0x8));
                    return;
                }
                if (opcode === 0x9) {
                    socket.write(encodeFrame(payload, 0xA));
                    continue;
                }
                if (opcode === 0x1 || opcode === 0x2) {
                    socket.write(encodeFrame(payload, opcode));
                }
            }
        } catch (error) {
            console.warn('Invalid WebSocket frame:', error.message);
            socket.destroy();
        }
    });
}

const server = http.createServer(serveStatic);
server.on('upgrade', (request, socket) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/ws') {
        socket.destroy();
        return;
    }
    handleWebSocket(request, socket);
});
server.listen(port, '0.0.0.0', () => {
    console.log('Smart Edge WebSocket latency demo listening on port ' + port);
});
