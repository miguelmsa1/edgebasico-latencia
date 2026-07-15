const regionEl = document.getElementById('edge-region');
const runButton = document.getElementById('run-test');
const statusEl = document.getElementById('status');
const clientIpEl = document.getElementById('client-ip');
const networkEl = document.getElementById('network');
const summaryMedianEl = document.getElementById('summary-median');
const summaryFastestEl = document.getElementById('summary-fastest');
const resultBody = document.getElementById('result-body');

const testRounds = 50;
const warmupRounds = 5;
const roundPauseMs = 20;
const payloadSize = 64;
const providerLogos = {
    'app-edge': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    'edge-madrid': { src: '/logo_telefonica.png', alt: 'Telefónica' },
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
    targets = Array.isArray(config.targets) ? config.targets.slice(0, 3) : [];
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
    const median = percentile(values, 0.5);
    return {
        min: Math.min(...values),
        median,
        max: Math.max(...values),
        jitter: percentile(values.map((value) => Math.abs(value - median)), 0.5)
    };
}

function formatLatency(value) {
    return Number.isFinite(value) ? value.toFixed(1) + ' ms' : 'No disponible';
}

function formatVsFastest(summary, fastest) {
    if (!summary || !fastest) return 'No disponible';
    const difference = summary.median - fastest.median;
    if (Math.abs(difference) < 0.05) return 'Más rápido';
    const percentage = fastest.median > 0 ? (difference / fastest.median) * 100 : null;
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
            ? '<td>Pendiente</td><td>Pendiente</td><td>Pendiente</td><td>Pendiente</td>'
            : '<td>No configurado</td><td>—</td><td>—</td><td>—</td>') + '</tr>'
    )).join('');
}

function updateProgressRow(id, lastLatency) {
    const row = resultBody.querySelector('tr[data-target="' + id + '"]');
    if (!row) return;
    row.children[1].textContent = formatLatency(lastLatency);
    row.children[2].textContent = 'Midiendo…';
    row.children[3].textContent = 'Midiendo…';
    row.children[4].textContent = 'Midiendo…';
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
    row.children[1].textContent = formatLatency(summary.median);
    row.children[2].textContent = formatVsFastest(summary, fastest);
    row.children[3].textContent = formatLatency(summary.min) + ' / ' + formatLatency(summary.max);
    row.children[4].textContent = formatLatency(summary.jitter);
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

function measureWebSocketRtt(socket) {
    return new Promise((resolve, reject) => {
        const payload = new Uint8Array(payloadSize);
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Timeout WebSocket'));
        }, 5000);
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
            if (responseSize !== payloadSize) {
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
    const samples = [];
    try {
        for (let round = 1; round <= warmupRounds; round += 1) {
            statusEl.textContent = target.label + ': calentamiento ' + round + '/' + warmupRounds + '…';
            try { await measureWebSocketRtt(socket); } catch (error) { console.warn(error); }
            if (round < warmupRounds) await sleep(roundPauseMs);
        }
        for (let round = 1; round <= testRounds; round += 1) {
            statusEl.textContent = target.label + ': ronda ' + round + '/' + testRounds + '…';
            try {
                const latency = await measureWebSocketRtt(socket);
                samples.push(latency);
                updateProgressRow(target.id, latency);
            } catch (error) {
                console.warn('Fallo en ronda ' + round + ' para ' + target.label, error);
            }
            if (round < testRounds) await sleep(roundPauseMs);
        }
    } finally {
        if (socket.readyState === WebSocket.OPEN) socket.close();
    }
    return { ...target, summary: summarize(samples) };
}

async function runTest() {
    runButton.disabled = true;
    statusEl.textContent = 'Abriendo canales WebSocket…';
    clientIpEl.textContent = 'Detectando…';
    networkEl.textContent = 'Consultando…';
    summaryMedianEl.textContent = 'Pendiente';
    summaryFastestEl.textContent = 'Pendiente';
    renderPendingRows();

    try {
        const results = await Promise.all(targets.map(async (target) => {
            if (!target.url) return { ...target, summary: null, unconfigured: true };
            try { return await measureTarget(target); }
            catch (error) {
                console.warn('No se pudo medir ' + target.label, error);
                return { ...target, summary: null };
            }
        }));
        const fastest = results.filter((result) => result.summary).reduce((best, result) => (
            !best || result.summary.median < best.summary.median ? result : best
        ), null);
        for (const result of results) {
            updateSummaryRow(result.id, result.summary, fastest && fastest.summary, result.unconfigured);
        }
        const appEdge = results.find((result) => result.id === 'app-edge' && result.summary);
        summaryMedianEl.textContent = appEdge ? formatLatency(appEdge.summary.median) : 'No disponible';
        summaryFastestEl.textContent = fastest
            ? fastest.label + ' · ' + formatLatency(fastest.summary.median)
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
