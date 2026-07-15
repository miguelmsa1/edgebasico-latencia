const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const port = Number(process.env.PORT || process.env.BACKEND_PORT || 8080);
const backendName = process.env.BACKEND_NAME || 'Backend de latencia';
const startedAt = new Date();
const stats = {
    websocketConnections: 0,
    activeConnections: 0,
    tests: 0,
    bytesEchoed: 0,
    lastTestAt: null
};

function sendJson(response, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'access-control-allow-origin': '*'
    });
    response.end(body);
}

function serveHttp(request, response) {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/healthz') {
        sendJson(response, { status: 'ok', name: backendName, startedAt: startedAt.toISOString() });
        return;
    }
    if (requestUrl.pathname === '/stats.json') {
        sendJson(response, { name: backendName, ...stats, startedAt: startedAt.toISOString(), uptimeSeconds: Math.floor(process.uptime()) });
        return;
    }
    const relative = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, '');
    const filePath = path.join(publicDir, relative);
    if (!filePath.startsWith(publicDir)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    fs.readFile(filePath, (error, data) => {
        if (error) {
            response.writeHead(404).end('Not found');
            return;
        }
        const contentType = path.extname(filePath) === '.js'
            ? 'application/javascript; charset=utf-8'
            : 'text/html; charset=utf-8';
        response.writeHead(200, {
            'content-type': contentType,
            'content-length': data.length,
            'cache-control': 'no-store'
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
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    let header;
    if (body.length < 126) {
        header = Buffer.from([0x80 | opcode, body.length]);
    } else if (body.length <= 0xffff) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(body.length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(body.length), 2);
    }
    return Buffer.concat([header, body]);
}

function tryReadFrame(buffer) {
    if (buffer.length < 2) return null;
    const first = buffer[0];
    const second = buffer[1];
    if ((first & 0x80) === 0) throw new Error('Fragmented frames are not supported');
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
        if (buffer.length < offset + 2) return null;
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buffer.length < offset + 8) return null;
        const bigLength = buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame too large');
        length = Number(bigLength);
        offset += 8;
    }
    const frameLength = offset + (masked ? 4 : 0) + length;
    if (buffer.length < frameLength) return null;
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    return { opcode, payload, remaining: buffer.subarray(frameLength) };
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
        '', ''
    ].join('\r\n'));

    stats.websocketConnections += 1;
    stats.activeConnections += 1;
    let buffer = Buffer.alloc(0);
    let connectionClosed = false;
    function closeConnection() {
        if (!connectionClosed) {
            connectionClosed = true;
            stats.activeConnections = Math.max(0, stats.activeConnections - 1);
        }
    }
    socket.on('close', closeConnection);
    socket.on('error', closeConnection);
    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
            while (buffer.length) {
                const frame = tryReadFrame(buffer);
                if (!frame) break;
                buffer = frame.remaining;
                if (frame.opcode === 0x8) {
                    socket.end(encodeFrame(Buffer.alloc(0), 0x8));
                    return;
                }
                if (frame.opcode === 0x9) {
                    socket.write(encodeFrame(frame.payload, 0xA));
                    continue;
                }
                if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                    stats.tests += 1;
                    stats.bytesEchoed += frame.payload.length;
                    stats.lastTestAt = new Date().toISOString();
                    socket.write(encodeFrame(frame.payload, frame.opcode));
                }
            }
        } catch (error) {
            console.warn('Invalid WebSocket frame:', error.message);
            socket.destroy();
        }
    });
}

const server = http.createServer(serveHttp);
server.on('upgrade', (request, socket) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/ws') {
        socket.destroy();
        return;
    }
    handleWebSocket(request, socket);
});
server.listen(port, '0.0.0.0', () => {
    console.log(`${backendName} listening on port ${port}`);
});
