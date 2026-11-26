'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function summarize(values,attempts){
    const s=[...values].sort((a,b)=>a-b);
    const p=q=>{if(!s.length)return null;const i=(s.length-1)*q,a=Math.floor(i),b=Math.ceil(i);return s[a]+(s[b]-s[a])*(i-a);};
    return {mean:s.length?s.reduce((a,b)=>a+b,0)/s.length:null,min:s[0]??null,p50:p(.5),p90:p(.9),p95:p(.95),p99:p(.99),
        jitter:values.length>1?values.slice(1).reduce((a,v,i)=>a+Math.abs(v-values[i]),0)/(values.length-1):null,
        samples:s.length,attempts,failureRate:attempts?100*(attempts-s.length)/attempts:null};
}
function matchesEcho(data,payload){
    return data instanceof ArrayBuffer&&data.byteLength===payload.byteLength&&new Uint8Array(data).every((v,i)=>v===payload[i]);
}
function openSocket(url){
    return new Promise((resolve,reject)=>{
        const socket=new WebSocket(url);socket.binaryType='arraybuffer';
        const fail=()=>{cleanup();socket.close();reject(new Error('No se pudo abrir WebSocket'));};
        const opened=()=>{cleanup();resolve(socket);};
        const cleanup=()=>{clearTimeout(timer);socket.removeEventListener('open',opened);socket.removeEventListener('error',fail);socket.removeEventListener('close',fail);};
        const timer=setTimeout(fail,5000);
        socket.addEventListener('open',opened);socket.addEventListener('error',fail);socket.addEventListener('close',fail);
    });
}
function echo(socket,size,sequence,timeout){
    const payload=new Uint8Array(size);new DataView(payload.buffer).setUint32(0,sequence);
    return new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);socket.removeEventListener('message',message);socket.removeEventListener('close',fail);socket.removeEventListener('error',fail);};
        const fail=()=>{cleanup();reject(new Error('Eco no recibido'));};
        const message=e=>{if(!matchesEcho(e.data,payload))return;const elapsed=performance.now()-start;cleanup();resolve(elapsed);};
        const timer=setTimeout(fail,timeout);
        socket.addEventListener('message',message);socket.addEventListener('close',fail);socket.addEventListener('error',fail);
        const start=performance.now();
        try{socket.send(payload);}catch(e){cleanup();reject(e);}
    });
}
async function httpsProbe(url,timeout){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    const start=performance.now();
    try{
        // An opaque response does not imply API success; measure response availability only.
        await fetch(url,{mode:'no-cors',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
        return performance.now()-start;
    }finally{clearTimeout(timer);}
}
async function measure(t,c,emit){
    const http=t.protocol==='https', rounds=http?c.httpsRounds:c.rounds,interval=http?c.httpsIntervalMs:c.intervalMs;
    const values=[];let socket,attempts=0,failures=0,sequence=0,error=null;
    try{
        if(!http)socket=await openSocket(t.url);
        const probe=()=>http?httpsProbe(t.url,c.timeoutMs):echo(socket,c.packetSize,++sequence,c.timeoutMs);
        for(let i=0;i<(http?1:c.warmups);i++){const start=performance.now();try{await probe();}catch{}await sleep(Math.max(0,interval-(performance.now()-start)));}
        for(let i=0;i<rounds;i++){
            const start=performance.now();attempts++;let last=null;
            try{last=await probe();values.push(last);failures=0;}catch(e){failures++;error=e.message;}
            emit({id:t.id,attempts,rounds,last});
            if(failures>=c.maxConsecutiveFailures){error='Demasiados fallos consecutivos';break;}
            if(i+1<rounds)await sleep(Math.max(0,interval-(performance.now()-start)));
        }
    }catch(e){error=e.message;}finally{if(socket)socket.close();}
    return {...t,summary:summarize(values,attempts),error:attempts<rounds||!values.length||failures>=c.maxConsecutiveFailures?error:null,planned:rounds};
}
if(typeof module!=='undefined')module.exports={summarize,matchesEcho,measure,echo};
if(typeof self!=='undefined'&&typeof self.postMessage==='function')self.onmessage=async({data})=>{
    const latest=new Map(),emit=u=>latest.set(u.id,u);
    const timer=setInterval(()=>self.postMessage({type:'progress',updates:[...latest.values()]}),250);
    try{self.postMessage({type:'done',results:await Promise.all(data.targets.map(t=>measure(t,data.config,emit)))});}
    catch(e){self.postMessage({type:'error',message:e.message});}finally{clearInterval(timer);}
};
