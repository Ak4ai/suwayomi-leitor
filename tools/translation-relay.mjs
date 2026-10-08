// Local same-origin relay for the two public providers. Fixed destinations;
// no arbitrary URLs, credentials, or API keys are accepted.
let active=0;
const cooldowns=new Map();
export async function handleTranslationRelay(request,response){
    const url=new URL(request.url||'/','http://localhost');
    if(url.pathname!=='/api/ihc/translate')return false;
    const send=(status,body)=>{if(!response.destroyed)response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(body));};
    if(request.method!=='GET'){send(405,{error:'Método não permitido.'});return true;}
    if(request.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Origem não permitida.'});return true;}
    if(request.headers.origin){try{if(new URL(request.headers.origin).host!==request.headers.host){send(403,{error:'Origem não permitida.'});return true;}}catch{send(403,{error:'Origem inválida.'});return true;}}
    if(url.searchParams.get('health')==='1'){send(200,{ihcTranslationRelay:true});return true;}
    const provider=url.searchParams.get('provider'),text=url.searchParams.get('q')||'';
    if(!['google','mymemory'].includes(provider)||!text.trim()||Buffer.byteLength(text,'utf8')>500){send(400,{error:'Tradutor ou texto inválido (limite de 500 bytes).'});return true;}
    const waitSeconds=Math.ceil(((cooldowns.get(provider)||0)-Date.now())/1000);
    if(waitSeconds>0){response.setHeader('Retry-After',String(waitSeconds));send(429,{error:`${provider==='google'?'Google':'MyMemory'} limitou as consultas. Aguarde pelo menos ${waitSeconds} s ou selecione outro tradutor.`,retryAfterSeconds:waitSeconds});return true;}
    if(active>=4){send(429,{error:'Muitas traduções locais simultâneas. Tente novamente.'});return true;}
    const endpoint=new URL(provider==='google'?'https://translate.googleapis.com/translate_a/single':'https://mymemory.translated.net/api/get');
    for(const [key,value] of Object.entries(provider==='google'?{client:'gtx',sl:'en',tl:'pt',dt:'t',q:text}:{q:text,langpair:'en|pt'}))endpoint.searchParams.set(key,value);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000),closed=()=>controller.abort();response.once('close',closed);active++;
    try{
        const upstream=await fetch(endpoint,{signal:controller.signal,redirect:'error'});
        if(!upstream.ok){
            if(upstream.status===429){const header=upstream.headers.get('retry-after'),seconds=Math.max(60,Number(header)||Math.ceil((Date.parse(header||'')-Date.now())/1000)||60);cooldowns.set(provider,Date.now()+seconds*1000);response.setHeader('Retry-After',String(seconds));send(429,{error:`${provider==='google'?'Google':'MyMemory'} respondeu HTTP 429: limite de consultas. Aguarde pelo menos ${seconds} s ou selecione outro tradutor.`,retryAfterSeconds:seconds});}
            else send(upstream.status,{error:`${provider==='google'?'Google':'MyMemory'} respondeu HTTP ${upstream.status}.`});return true;
        }
        let body;try{body=await upstream.json();}catch{send(502,{error:'O tradutor retornou uma resposta inválida.'});return true;}
        send(200,body);
    }catch(error){send(controller.signal.aborted?504:502,{error:controller.signal.aborted?'O tradutor demorou demais para responder.':'O servidor local não conseguiu acessar o tradutor por HTTPS.'});}
    finally{active--;clearTimeout(timer);response.removeListener('close',closed);}
    return true;
}
