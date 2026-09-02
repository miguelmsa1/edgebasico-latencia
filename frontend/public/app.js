const regionEl = document.getElementById('edge-region');
const runButton = document.getElementById('run-test');
const statusEl = document.getElementById('status');
const clientIpEl = document.getElementById('client-ip');
const networkEl = document.getElementById('network');
const summaryMeanEl = document.getElementById('summary-mean');
const summaryFastestEl = document.getElementById('summary-fastest');
const resultBody = document.getElementById('result-body');

const testBursts = [
    { packetSize: 64, rounds: 500, pauseMs: 100 }
];
const maxConsecutiveFailures = 10;
const echoTimeoutMs = 2000;
const providerLogos = {
    'app-edge': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    'edge-madrid': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    'edge-bcn': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    azure: { src: '/logo_azure.svg', alt: 'Azure' }
};

let targets = [];

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
}

async function loadConfig() {
    const response = await fetch('/app-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar la configuración');
    const config = await response.json();
    regionEl.textContent = config.region || 'No configurada';
    targets = Array.isArray(config.targets) ? config.targets.slice(0, 4) : [];
    renderPendingRows();
}

function isPrivateIp(ip) {
    return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|fc|fd)/i.test(ip || '');
}

async function lookupNetwork(ip) {
    const target = ip && !isPrivateIp(ip) ? '/' + encodeURIComponent(ip) : '';
    const response = await fetch('https://ipwho.is' + target, { cache: 'no-store' });
    const data = await response.json();
    if (data.success === false) return null;
    return {
        ip: data.ip,
        city: data.city,
        country: data.country,
        isp: data.connection && (data.connection.isp || data.connection.org)
    };
}

async function updateClientInfo() {
    try {
        const response = await fetch('/client-info.json', { cache: 'no-store' });
        const info = await response.json();
        const ip = info.ip || null;
        clientIpEl.textContent = ip || 'No disponible';
        const network = await lookupNetwork(ip);
        if (!network) {
            networkEl.textContent = 'No disponible';
            return;
        }
        if (!ip && network.ip) clientIpEl.textContent = network.ip;
        const place = [network.city, network.country].filter(Boolean).join(', ');
        networkEl.textContent = [place, network.isp].filter(Boolean).join(' · ') || 'No disponible';
    } catch (error) {
        console.warn('No se pudo consultar IP, ubicación u operador', error);
        clientIpEl.textContent = 'No disponible';
        networkEl.textContent = 'No disponible';
    }
}

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function percentile(values, rank) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * rank;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper
        ? sorted[lower]
        : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values) {
    if (!values.length) return null;
    return {
        mean: values.reduce((total, value) => total + value, 0) / values.length,
        p90: percentile(values, 0.9),
        samples: values.length
    };
}

function formatLatency(value) {
    return Number.isFinite(value) ? value.toFixed(1) + ' ms' : 'No disponible';
}

function formatVsFastest(summary, fastest) {
    if (!summary || !fastest) return 'No disponible';
    const difference = summary.mean - fastest.mean;
    if (Math.abs(difference) < 0.05) return 'Más rápido';
    const percentage = fastest.mean > 0 ? (difference / fastest.mean) * 100 : null;
    return '+' + difference.toFixed(1) + ' ms' + (Number.isFinite(percentage) ? ' (+' + percentage.toFixed(0) + '%)' : '');
}

function renderTargetCell(target) {
    const logo = providerLogos[target.id];
    const logoHtml = logo
        ? '<img class="provider-logo provider-logo-' + target.id + '" src="' + logo.src + '" alt="' + logo.alt + '">'
        : '';
    return '<td><div class="provider">' + logoHtml + '<strong>' + escapeHtml(target.label) + '</strong></div></td>';
}

function renderPendingRows() {
    resultBody.innerHTML = targets.map((target) => (
        '<tr data-target="' + escapeHtml(target.id) + '">' + renderTargetCell(target) +
        (target.url
            ? '<td>Pendiente</td><td>Pendiente</td><td>Pendiente</td>'
            : '<td>No configurado</td><td>—</td><td>—</td>') + '</tr>'
    )).join('');
}

function updateProgressRow(id, lastLatency) {
    const row = resultBody.querySelector('tr[data-target="' + id + '"]');
    if (!row) return;
    row.children[1].textContent = formatLatency(lastLatency);
    row.children[2].textContent = 'Midiendo…';
    row.children[3].textContent = 'Midiendo…';
}

function updateTargetError(id, message = 'Error de conexión') {
    const row = resultBody.querySelector('tr[data-target="' + id + '"]');
    if (!row) return;
    row.children[1].textContent = message;
    for (let i = 2; i < row.children.length; i += 1) row.children[i].textContent = '—';
}

function updateSummaryRow(id, summary, fastest, unconfigured = false) {
    const row = resultBody.querySelector('tr[data-target="' + id + '"]');
    if (!row) return;
    if (unconfigured) {
        row.children[1].textContent = 'No configurado';
        for (let i = 2; i < row.children.length; i += 1) row.children[i].textContent = '—';
        return;
    }
    if (!summary) {
        for (let i = 1; i < row.children.length; i += 1) row.children[i].textContent = 'Error';
        return;
    }
    row.children[1].textContent = formatLatency(summary.mean);
    row.children[2].textContent = formatLatency(summary.p90);
    row.children[3].textContent = formatVsFastest(summary, fastest);
}

function openSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        const timeout = window.setTimeout(() => {
            socket.close();
            reject(new Error('Timeout al abrir WebSocket'));
        }, 5000);
        socket.addEventListener('open', () => {
            window.clearTimeout(timeout);
            resolve(socket);
        }, { once: true });
        socket.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error('No se pudo abrir WebSocket'));
        }, { once: true });
    });
}

function measureWebSocketRtt(socket, packetSize) {
    return new Promise((resolve, reject) => {
        const payload = new Uint8Array(packetSize);
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Timeout WebSocket'));
        }, echoTimeoutMs);
        function cleanup() {
            window.clearTimeout(timeout);
            socket.removeEventListener('message', onMessage);
            socket.removeEventListener('error', onError);
        }
        function onError() {
            cleanup();
            reject(new Error('Error WebSocket'));
        }
        function onMessage(event) {
            const elapsed = performance.now() - start;
            const responseSize = event.data && event.data.byteLength;
            cleanup();
            if (responseSize !== packetSize) {
                reject(new Error('Respuesta con tamaño inesperado'));
                return;
            }
            resolve(elapsed);
        }
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', onError);
        const start = performance.now();
        socket.send(payload);
    });
}

async function measureTarget(target) {
    const socket = await openSocket(target.url);
    const burstResults = [];
    try {
        for (const burst of testBursts) {
            const samples = [];
            let consecutiveFailures = 0;
            for (let round = 1; round <= burst.rounds; round += 1) {
                const roundStartedAt = performance.now();
                statusEl.textContent = target.label + ': ' + burst.packetSize + ' B · ping ' + round + '/' + burst.rounds + '…';
                try {
                    const latency = await measureWebSocketRtt(socket, burst.packetSize);
                    samples.push(latency);
                    consecutiveFailures = 0;
                    updateProgressRow(target.id, latency);
                } catch (error) {
                    consecutiveFailures += 1;
                    console.warn('Fallo en ping ' + round + ' de ' + burst.packetSize + ' B para ' + target.label, error);
                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        const message = 'Error tras ' + maxConsecutiveFailures + ' intentos';
                        updateTargetError(target.id, message);
                        throw new Error(message);
                    }
                }
                if (round < burst.rounds) {
                    const remainingPause = Math.max(0, burst.pauseMs - (performance.now() - roundStartedAt));
                    await sleep(remainingPause);
                }
            }
            burstResults.push({ packetSize: burst.packetSize, summary: summarize(samples) });
        }
    } finally {
        if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    return { ...target, bursts: burstResults, summary: burstResults[0] && burstResults[0].summary };
}

async function runTest() {
    runButton.disabled = true;
    statusEl.textContent = 'Abriendo canales WebSocket…';
    clientIpEl.textContent = 'Detectando…';
    networkEl.textContent = 'Consultando…';
    summaryMeanEl.textContent = 'Pendiente';
    summaryFastestEl.textContent = 'Pendiente';
    renderPendingRows();

    try {
        const results = await Promise.all(targets.map(async (target) => {
            if (!target.url) return { ...target, summary: null, unconfigured: true };
            try { return await measureTarget(target); }
            catch (error) {
                console.warn('No se pudo medir ' + target.label, error);
                updateTargetError(target.id, error.message || 'Error de conexión');
                return { ...target, summary: null, error: true };
            }
        }));
        const fastest = results.filter((result) => result.summary).reduce((best, result) => (
            !best || result.summary.mean < best.summary.mean ? result : best
        ), null);
        for (const result of results) {
            updateSummaryRow(result.id, result.summary, fastest && fastest.summary, result.unconfigured);
        }
        const appEdge = results.find((result) => result.id === 'app-edge' && result.summary);
        summaryMeanEl.textContent = appEdge ? formatLatency(appEdge.summary.mean) : 'No disponible';
        summaryFastestEl.textContent = fastest
            ? fastest.label + ' · ' + formatLatency(fastest.summary.mean)
            : 'No disponible';
        statusEl.textContent = 'RTT calculado. Consultando IP y operador…';
        await updateClientInfo();
        statusEl.textContent = 'Test completado';
    } catch (error) {
        console.error(error);
        statusEl.textContent = 'No se pudo completar el test WebSocket.';
    } finally {
        runButton.disabled = false;
    }
}

loadConfig().catch((error) => {
    console.error(error);
    statusEl.textContent = 'No se pudo cargar la configuración de la demo.';
});
runButton.addEventListener('click', runTest);
