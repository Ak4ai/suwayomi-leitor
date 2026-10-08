export const normalizeSource=text=>text.normalize('NFC').replace(/[‘’]/g,"'").replace(/…/g,'...').replace(/\s+/g,' ').trim().toLowerCase().replace(/[.!?]+$/,'').trim();
export function suspiciouslyShort(source,target){
    const words=text=>text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu)||[],a=words(source),b=words(target);
    return a.length>=8&&b.length<Math.max(3,Math.ceil(a.length*.3))&&b.join('').length<a.join('').length*.45;
}
export function pickMemoryTranslation(body,source){
    const exact=(body.matches||[]).filter(m=>typeof m.segment==='string'&&normalizeSource(m.segment)===normalizeSource(source)&&typeof m.translation==='string'&&m.translation.trim()).sort((a,b)=>Number(b.match||0)-Number(a.match||0));
    let value=exact[0]?.translation;
    if(!value&&!(body.matches||[]).length&&Number(body.responseData?.match)===1)value=body.responseData?.translatedText;
    if(typeof value!=='string'||!value.trim()||suspiciouslyShort(source,value)){
        const error=new Error('MyMemory devolveu uma correspondência parcial ou uma tradução incompleta. Use outro tradutor ou tente novamente.');
        error.code='INCOMPLETE_TRANSLATION';error.candidate=body.responseData?.translatedText||'';throw error;
    }
    return value;
}
let relayAvailable;
async function requestURL(value){
    const original=new URL(value),provider=original.hostname==='translate.googleapis.com'?'google':['mymemory.translated.net','api.mymemory.translated.net'].includes(original.hostname)?'mymemory':null;
    if(!provider||typeof document==='undefined')return value;
    const relay=new URL('api/ihc/translate',document.baseURI);
    relayAvailable??=fetch(new URL(`${relay.pathname}?health=1`,relay),{signal:AbortSignal.timeout(1500),credentials:'omit',cache:'no-store'}).then(async response=>response.ok&&(response.headers.get('content-type')||'').includes('application/json')&&(await response.json()).ihcTranslationRelay===true).catch(()=>false);
    if(!await relayAvailable)return value;
    relay.searchParams.set('provider',provider);relay.searchParams.set('q',original.searchParams.get('q')||'');return relay;
}
export async function translationRequest(url,signal,timeoutMs=15000){
    signal?.throwIfAborted();const controller=new AbortController(),abort=()=>controller.abort(signal.reason);let timedOut=false;
    signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try{
        const target=await requestURL(url);controller.signal.throwIfAborted();
        const response=await fetch(target,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
        let body;
        if(response.ok){try{body=await response.json();}catch(cause){const invalid=new Error('O tradutor retornou uma resposta inválida. Tente novamente ou selecione outro serviço.');invalid.code='INVALID_TRANSLATION_RESPONSE';throw invalid;}}
        else{let details;try{details=await response.json();}catch{}const error=new Error(typeof details?.error==='string'?details.error.slice(0,250):`Tradutor respondeu HTTP ${response.status}. Tente novamente ou selecione outro serviço.`);error.httpStatus=response.status;throw error;}
        return body;
    }catch(error){
        if(signal?.aborted)throw signal.reason||error;
        if(timedOut){const failure=new Error(`O tradutor excedeu ${Math.round(timeoutMs/1000)} s para responder. A fala não foi concluída; tente novamente.`);failure.code='TRANSLATION_TIMEOUT';throw failure;}
        if(error instanceof TypeError){const host=new URL(url).hostname;const failure=new Error(`Não foi possível acessar ${host}. Verifique a conexão e os detalhes no Console do navegador; pode haver bloqueio de rede, CORS, certificado ou extensão.`);failure.isNetworkError=true;failure.code='TRANSLATION_CONNECTION_FAILED';throw failure;}
        throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
