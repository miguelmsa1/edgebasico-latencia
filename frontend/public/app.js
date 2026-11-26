const regionEl = document.getElementById('edge-region');
const runButton = document.getElementById('run-test');
const statusEl = document.getElementById('status');
const clientIpEl = document.getElementById('client-ip');
const networkEl = document.getElementById('network');
const summaryMeanEl = document.getElementById('summary-mean');
const summaryFastestEl = document.getElementById('summary-fastest');
const resultBody = document.getElementById('result-body');
const progressEl = document.querySelector('.progress');
const progressBar = document.getElementById('progress-bar');

let measurement;
let invalidVisibility=false;
let running=false;
document.addEventListener('visibilitychange',()=>{if(running&&document.hidden)invalidVisibility=true;});
const providerLogos = {
    'app-edge': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    'edge-madrid': { src: '/logo_telefonica.png', alt: 'Telefónica' },
    'edge-bcn': { src: '/logo_telefonica.png', alt: 'Telefónica' }
};

let targets = [];
let completedPings = 0;
let totalPings = 0;

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
    targets = Array.isArray(config.targets) ? config.targets : [];
    measurement = config.measurement;
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

function formatLatency(value){return Number.isFinite(value)?value.toFixed(1)+' ms':'—';}
function renderRows(results=[]){
    const byId=new Map(results.map(r=>[r.id,r]));
    const valid=results.filter(r=>r.protocol==='websocket'&&!r.error&&r.summary.samples&&r.summary.samples===r.summary.attempts);
    const fastest=valid.reduce((best,r)=>!best||r.summary.mean<best.summary.mean?r:best,null);
    resultBody.replaceChildren();
    for(const target of targets){
        const row=document.createElement('tr');row.dataset.target=target.id;
        const r=byId.get(target.id),s=r?.summary;
        const delta=target.protocol==='https'?'No comparable':r&&valid.includes(r)&&fastest?formatLatency(s.mean-fastest.summary.mean):'—';
        const name=document.createElement('td'),provider=document.createElement('div');provider.className='provider';
        const logo=providerLogos[target.id];if(logo){const image=document.createElement('img');image.src=logo.src;image.alt=logo.alt;image.className='provider-logo provider-logo-'+target.id;provider.append(image);}
        const label=document.createElement('strong');label.textContent=target.label;provider.append(label);name.append(provider);row.append(name);
        const cells=[target.protocol==='https'?'HTTPS':'WebSocket',
            s?.samples?formatLatency(s.mean):r?'Sin respuesta':'Pendiente',
            ...['min','p50','p90','p95','p99','jitter'].map(k=>s?formatLatency(s[k]):'—'),
            s?.attempts?s.failureRate.toFixed(1)+'% ('+s.samples+'/'+s.attempts+'; '+r.planned+' previstos)':'—',
            delta,r?.error||''];
        for(const value of cells){const td=document.createElement('td');td.textContent=value;row.append(td);}
        resultBody.append(row);
    }
    summaryFastestEl.textContent=fastest?fastest.label+' · '+formatLatency(fastest.summary.mean):'No disponible';
    const local=byId.get('app-edge');summaryMeanEl.textContent=local?.summary.samples?formatLatency(local.summary.mean):'No disponible';
}
function renderPendingRows(){renderRows();}
async function runTest(){
    if(running||!measurement)return;
    running=true;invalidVisibility=document.hidden;runButton.disabled=true;
    renderRows();statusEl.textContent='Calentamiento y medición…';progressBar.style.width='0%';progressEl.setAttribute('aria-valuenow','0');
    let worker;
    try{
        worker=new Worker('/measurement-worker.js');
        const results=await new Promise((resolve,reject)=>{
            worker.onerror=e=>reject(new Error(e.message||'Error del worker'));
            worker.onmessage=({data})=>{
                if(data.type==='done')resolve(data.results);
                if(data.type==='error')reject(new Error(data.message));
                if(data.type==='progress'){
                    const total=targets.reduce((n,t)=>n+(t.protocol==='https'?measurement.httpsRounds:measurement.rounds),0);
                    const done=data.updates.reduce((n,t)=>n+t.attempts,0);
                    const percent=Math.min(100,Math.round(100*done/total));
                    progressBar.style.width=percent+'%';progressEl.setAttribute('aria-valuenow',String(percent));
                    for(const t of data.updates){const row=[...resultBody.rows].find(r=>r.dataset.target===t.id);if(row)row.children[2].textContent=formatLatency(t.last)+' · '+t.attempts+'/'+t.rounds;}
                }
            };
            worker.postMessage({targets,config:measurement});
        });
        renderRows(results);progressBar.style.width='100%';progressEl.setAttribute('aria-valuenow','100');
        const hidden=invalidVisibility;
        statusEl.textContent=hidden?'Test completado: pestaña oculta; resultados potencialmente inválidos.':'Test completado';
        await updateClientInfo();
    }catch(e){statusEl.textContent='Error: '+e.message;}finally{worker?.terminate();running=false;runButton.disabled=false;}
}
runButton.disabled=true;
loadConfig().then(()=>{runButton.disabled=false;}).catch(e=>{statusEl.textContent=e.message;});
runButton.addEventListener('click',runTest);
