const regionEl = document.getElementById('edge-region');
const runButton = document.getElementById('run-test');
const statusEl = document.getElementById('status');
const clientIpEl = document.getElementById('client-ip');
const networkEl = document.getElementById('network');
const resultBody = document.getElementById('result-body');
const summaryBestEl = document.getElementById('summary-best');
const summaryEdgeEl = document.getElementById('summary-edge');
const summaryDiffEl = document.getElementById('summary-diff');
const summaryTargetsEl = document.getElementById('summary-targets');

const testRounds = 50;
const warmupRounds = 5;
const roundPauseMs = 20;
const payloadSizes = [
    { label: '64 B', size: 64, description: 'Baseline RTT' },
    { label: '512 B', size: 512, description: 'Payload medio' },
    { label: '1472 B', size: 1472, description: 'Payload grande' }
];
const providerLogos = {
    smartedge: { src: '/logo_telefonica.png', alt: 'Telefonica' },
    'edge-bilbao': { src: '/logo_telefonica.png', alt: 'Telefonica' },
    'edge-galicia': { src: '/logo_telefonica.png', alt: 'Telefonica' },
    'edge-barcelona': { src: '/logo_telefonica.png', alt: 'Telefonica' },
    'edge-sevilla': { src: '/logo_telefonica.png', alt: 'Telefonica' },
    azure: { src: '/logo_azure.svg', alt: 'Azure' },
    aws: { src: '/amazon-web-services.png', alt: 'AWS' },
    gcp: { src: '/logo_gcp.svg', alt: 'Google Cloud' }
};
const hiddenTargetIds = new Set(['aws', 'gcp']);

const fallbackTargets = [
    { id: 'edge-bilbao', label: 'Edge Bilbao', url: sameOriginWebSocketUrl(), primary: true, type: 'edge', configured: true },
    { id: 'edge-galicia', label: 'Edge Galicia', url: null, type: 'edge', configured: false },
    { id: 'edge-barcelona', label: 'Edge Barcelona', url: null, type: 'edge', configured: false },
    { id: 'edge-sevilla', label: 'Edge Sevilla', url: null, type: 'edge', configured: false },
    { id: 'azure', label: 'Azure', url: null, type: 'external', configured: false }
];

let targets = [];

function normalizeTarget(target) {
    const id = String(target.id || '').toLowerCase();
    const externalIds = new Set(['azure', 'aws', 'gcp']);
    return {
        ...target,
        id,
        type: target.type || (externalIds.has(id) ? 'external' : 'edge'),
        configured: Boolean(target.url)
    };
}

function visibleConfigTargets(configTargets) {
    return configTargets
        .map(normalizeTarget)
        .filter((target) => !hiddenTargetIds.has(target.id));
}

function sameOriginWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + window.location.host + '/ws';
}

async function loadConfig() {
    try {
        const response = await fetch('/app-config.json', { cache: 'no-store' });
        const config = await response.json();
        if (config.region) {
            regionEl.textContent = config.region;
        }
        targets = [
            { id: 'edge-bilbao', label: 'Edge Bilbao', url: sameOriginWebSocketUrl(), primary: true, type: 'edge', configured: true },
            ...(Array.isArray(config.targets) ? visibleConfigTargets(config.targets) : [])
        ];
    } catch (error) {
        console.warn('No se pudo cargar la configuracion', error);
        targets = fallbackTargets;
    }
    renderPendingRows();
}

function isPrivateIp(ip) {
    return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|fc|fd)/i.test(ip || '');
}

async function lookupNetwork(ip) {
    const target = ip && !isPrivateIp(ip) ? '/' + encodeURIComponent(ip) : '';
    const response = await fetch('https://ipwho.is' + target, { cache: 'no-store' });
    const data = await response.json();
    if (data.success === false) {
        return null;
    }
    return {
        ip: data.ip,
        city: data.city,
        country: data.country,
        isp: data.connection && (data.connection.isp || data.connection.org)
    };
}

async function updateClientInfo() {
    try {
        const clientResponse = await fetch('/client-info.json', { cache: 'no-store' });
        const clientInfo = await clientResponse.json();
        const ip = clientInfo.ip || null;
        clientIpEl.textContent = ip || 'No disponible';
        const network = await lookupNetwork(ip);
        if (network) {
            if (!ip && network.ip) {
                clientIpEl.textContent = network.ip;
            }
            const place = [network.city, network.country].filter(Boolean).join(', ');
            networkEl.textContent = [place, network.isp].filter(Boolean).join(' · ') || 'No disponible';
        } else {
            networkEl.textContent = 'No disponible';
        }
    } catch (error) {
        console.warn('No se pudo consultar IP, ubicacion u operador', error);
        clientIpEl.textContent = 'No disponible';
        networkEl.textContent = 'No disponible';
    }
}

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function percentile(values, rank) {
    if (!values.length) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * rank;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) {
        return sorted[lower];
    }
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values) {
    if (!values.length) {
        return null;
    }
    const median = percentile(values, 0.5);
    const deviations = values.map((value) => Math.abs(value - median));
    return {
        min: Math.min(...values),
        median,
        max: Math.max(...values),
        jitter: percentile(deviations, 0.5),
        count: values.length
    };
}

function average(values) {
    const finiteValues = values.filter(Number.isFinite);
    if (!finiteValues.length) {
        return null;
    }
    return finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length;
}

function summarizePayloadStats(payloadStats) {
    const validStats = payloadStats.filter(Boolean);
    if (!validStats.length) {
        return null;
    }
    return {
        min: average(validStats.map((stats) => stats.min)),
        median: average(validStats.map((stats) => stats.median)),
        max: average(validStats.map((stats) => stats.max)),
        jitter: average(validStats.map((stats) => stats.jitter)),
        count: validStats.reduce((total, stats) => total + stats.count, 0),
        expected: payloadSizes.length * testRounds
    };
}

function formatLatency(value) {
    if (!Number.isFinite(value)) {
        return 'No disponible';
    }
    return value.toFixed(1) + ' ms';
}

function formatDifferenceFromFastest(summary, fastestSummary) {
    if (!summary || !fastestSummary || !Number.isFinite(summary.median) || !Number.isFinite(fastestSummary.median)) {
        return 'Pendiente';
    }
    const differenceMs = summary.median - fastestSummary.median;
    if (Math.abs(differenceMs) < 0.05) {
        return 'Más rápido';
    }
    const differencePercent = fastestSummary.median > 0
        ? (differenceMs / fastestSummary.median) * 100
        : null;
    const msText = (differenceMs > 0 ? '+' : '') + differenceMs.toFixed(1) + ' ms';
    const percentText = Number.isFinite(differencePercent)
        ? ' (' + (differencePercent > 0 ? '+' : '') + differencePercent.toFixed(0) + '%)'
        : '';
    return msText + percentText;
}

function resetSummary() {
    summaryBestEl.textContent = 'Pendiente';
    summaryEdgeEl.textContent = 'Pendiente';
    summaryDiffEl.textContent = 'Pendiente';
    summaryTargetsEl.textContent = 'Pendiente';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function renderTargetCell(target) {
    const providerKey = String(target.id || '').toLowerCase();
    const logo = providerLogos[providerKey];
    const logoHtml = logo
        ? '<img class="provider-logo provider-logo-' + providerKey + '" src="' + logo.src + '" alt="' + logo.alt + '" loading="lazy">'
        : '<span class="provider-fallback" aria-hidden="true">' + escapeHtml((target.label || '?').charAt(0)) + '</span>';

    return (
        '<td>' +
            '<div class="provider">' +
                logoHtml +
                '<div>' +
                    '<strong>' + escapeHtml(target.label) + '</strong>' +
                '</div>' +
            '</div>' +
        '</td>'
    );
}

function updateGlobalSummary(targetResults) {
    const validResults = targetResults.filter((result) => result.summary);
    const edgeResult = targetResults.find((result) => result.id === 'edge-bilbao' && result.summary);
    const bestResult = validResults.reduce((best, result) => {
        if (!best || result.summary.median < best.summary.median) {
            return result;
        }
        return best;
    }, null);

    summaryBestEl.textContent = bestResult
        ? bestResult.label + ' · ' + formatLatency(bestResult.summary.median)
        : 'Pendiente';
    summaryEdgeEl.textContent = edgeResult ? formatLatency(edgeResult.summary.median) : 'Pendiente';
    summaryDiffEl.textContent = bestResult && edgeResult
        ? formatDifferenceFromFastest(edgeResult.summary, bestResult.summary)
        : 'Pendiente';
    summaryTargetsEl.textContent = validResults.length + '/' + targets.length;
}

function renderPendingRows() {
    const visibleTargets = targets.length ? targets : fallbackTargets;
    resultBody.innerHTML = visibleTargets.map((target) => (
        '<tr data-target="' + target.id + '">' +
            renderTargetCell(target) +
            '<td class="metric-value">Pendiente</td>' +
            '<td>Pendiente</td>' +
            '<td>Pendiente</td>' +
            '<td>Pendiente</td>' +
            '<td>Pendiente</td>' +
            '<td>0/' + (payloadSizes.length * testRounds) + '</td>' +
        '</tr>'
    )).join('');
}

function updateProgressRow(targetId, completedSamples, lastLatency) {
    const row = resultBody.querySelector('tr[data-target="' + targetId + '"]');
    if (!row) {
        return;
    }
    row.children[1].textContent = formatLatency(lastLatency);
    row.children[2].textContent = 'Midiendo...';
    row.children[3].textContent = 'Midiendo...';
    row.children[4].textContent = 'Midiendo...';
    row.children[5].textContent = 'Pendiente';
    row.children[6].textContent = completedSamples + '/' + (payloadSizes.length * testRounds);
}

function updateUnconfiguredRow(targetId) {
    const row = resultBody.querySelector('tr[data-target="' + targetId + '"]');
    if (!row) {
        return;
    }
    row.children[1].textContent = 'No configurado';
    row.children[2].textContent = 'No configurado';
    row.children[3].textContent = 'No configurado';
    row.children[4].textContent = 'No configurado';
    row.children[5].textContent = 'Pendiente';
    row.children[6].textContent = '0/' + (payloadSizes.length * testRounds);
}

function updateSummaryRow(targetId, summary, fastestSummary) {
    const row = resultBody.querySelector('tr[data-target="' + targetId + '"]');
    if (!row) {
        return;
    }
    if (!summary) {
        row.children[1].textContent = 'Error';
        row.children[2].textContent = 'Error';
        row.children[3].textContent = 'Error';
        row.children[4].textContent = 'Error';
        row.children[5].textContent = 'Error';
        row.children[6].textContent = '0/' + (payloadSizes.length * testRounds);
        return;
    }
    row.children[1].textContent = formatLatency(summary.median);
    row.children[2].textContent = formatLatency(summary.min);
    row.children[3].textContent = formatLatency(summary.max);
    row.children[4].textContent = formatLatency(summary.jitter);
    row.children[5].textContent = formatDifferenceFromFastest(summary, fastestSummary);
    row.children[6].textContent = summary.count + '/' + summary.expected;
}

function openSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        socket.addEventListener('open', () => resolve(socket), { once: true });
        socket.addEventListener('error', () => reject(new Error('No se pudo abrir WebSocket')), { once: true });
    });
}

function measureWebSocketRtt(socket, size) {
    return new Promise((resolve, reject) => {
        const payload = new Uint8Array(size);
        const timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error('Timeout WebSocket'));
        }, 5000);

        function cleanup() {
            window.clearTimeout(timeoutId);
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
            if (responseSize !== size) {
                reject(new Error('Respuesta inesperada: ' + responseSize + ' bytes'));
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
    if (!target.url) {
        updateUnconfiguredRow(target.id);
        return {
            id: target.id,
            label: target.label,
            summary: null,
            configured: false
        };
    }
    const socket = await openSocket(target.url);
    const payloadStats = [];
    let completedSamples = 0;

    try {
        for (const payload of payloadSizes) {
            const samples = [];
            for (let round = 1; round <= warmupRounds; round += 1) {
                statusEl.textContent = target.label + ' · ' + payload.label + ': calentamiento ' + round + '/' + warmupRounds + '...';
                try {
                    await measureWebSocketRtt(socket, payload.size);
                } catch (error) {
                    console.warn('Fallo en calentamiento ' + round + ' para ' + target.label + ' payload ' + payload.size, error);
                }
                if (round < warmupRounds) {
                    await sleep(roundPauseMs);
                }
            }
            for (let round = 1; round <= testRounds; round += 1) {
                statusEl.textContent = target.label + ' · ' + payload.label + ': ronda ' + round + '/' + testRounds + '...';
                try {
                    const latency = await measureWebSocketRtt(socket, payload.size);
                    samples.push(latency);
                    completedSamples += 1;
                    updateProgressRow(target.id, completedSamples, latency);
                } catch (error) {
                    console.warn('Fallo en ronda ' + round + ' para ' + target.label + ' payload ' + payload.size, error);
                }
                if (round < testRounds) {
                    await sleep(roundPauseMs);
                }
            }
            payloadStats.push(summarize(samples));
        }
    } finally {
        if (socket.readyState === WebSocket.OPEN) {
            socket.close();
        }
    }

    return {
        id: target.id,
        label: target.label,
        summary: summarizePayloadStats(payloadStats),
        configured: true
    };
}

async function runTest() {
    runButton.disabled = true;
    statusEl.textContent = 'Abriendo canales WebSocket...';
    clientIpEl.textContent = 'Detectando...';
    networkEl.textContent = 'Consultando...';
    renderPendingRows();
    resetSummary();

    try {
        const targetResults = await Promise.all(targets.map(async (target) => {
            try {
                return await measureTarget(target);
            } catch (error) {
                console.warn('No se pudo medir ' + target.label, error);
                return { id: target.id, label: target.label, summary: null, configured: Boolean(target.url) };
            }
        }));

        const fastestSummary = targetResults
            .filter((result) => result.summary)
            .reduce((fastest, result) => {
                if (!fastest || result.summary.median < fastest.median) {
                    return result.summary;
                }
                return fastest;
            }, null);
        for (const result of targetResults) {
            if (result.configured === false) {
                updateUnconfiguredRow(result.id);
            } else {
                updateSummaryRow(result.id, result.summary, fastestSummary);
            }
        }
        updateGlobalSummary(targetResults);

        statusEl.textContent = 'RTT WebSocket calculado. Consultando IP y operador...';
        await updateClientInfo();
        statusEl.textContent = 'Test completado';
    } catch (error) {
        console.error(error);
        statusEl.textContent = 'No se pudo completar el test WebSocket.';
    } finally {
        runButton.disabled = false;
    }
}

loadConfig();
resetSummary();
runButton.addEventListener('click', runTest);
