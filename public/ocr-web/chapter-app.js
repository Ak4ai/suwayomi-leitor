import {ChapterQueue} from './chapter-queue.js';
import {ChapterEngine} from './chapter-engine.js';
import {ReadableLettering,loadLetteringFonts,renderScale} from './lettering.js';
import {library,chapters,chapterPages} from './suwayomi.js';
import {listGeminiModels} from './translation.js';
import {loadPreferences,savePreferences} from './chapter-preferences.js';
import {imageQuality} from './image-quality.js';
const $=id=>document.getElementById(id),engine=new ChapterEngine(),lettering=new ReadableLettering(),blobs=new Map();
let bitmap=null,shown=-1,drawRevision=0,fontReady=false,settings=null,serverController=null,renderedJob=null,renderedRevision=-1,renderedStatus='',modelsRevision=0;
const labels={pending:'Na fila',loading:'Carregando',ocr:'Reconhecendo',translating:'Traduzindo',ready:'Pronta',failed:'Falha'};
async function blobFor(job,signal){
    if(job.file)return job.file;
    if(blobs.has(job.id))return blobs.get(job.id);
    const promise=fetch(job.url,{signal,credentials:'include'}).then(response=>{if(!response.ok)throw new Error(`Imagem HTTP ${response.status}.`);return response.blob();});
    blobs.set(job.id,promise);
    try{const blob=await promise;signal?.throwIfAborted();for(const key of blobs.keys())if(key!==job.id&&blobs.size>3)blobs.delete(key);return blob;}
    catch(error){if(blobs.get(job.id)===promise)blobs.delete(job.id);throw error;}
}
const queue=new ChapterQueue(async(job,signal,update)=>engine.process(job,await blobFor(job,signal),settings,signal,update),()=>refresh());
function refresh(){
    const ready=queue.jobs.filter(j=>j.status==='ready').length,current=queue.jobs[queue.current],active=queue.jobs.find(j=>['loading','ocr','translating'].includes(j.status));
    const failed=queue.jobs.find(j=>j.status==='failed');
    $('queue-status').textContent=queue.jobs.length?`${ready}/${queue.jobs.length} páginas prontas. ${queue.paused?`Fila pausada.${failed?` ${failed.name}: ${failed.error}`:''}`:active?`${active.name}: ${labels[active.status]}. ${active.message||''}`:'Páginas próximas preparadas.'}`:'Importe páginas ou abra um capítulo.';
    $('start').disabled=!queue.jobs.length||!queue.paused;$('pause').disabled=queue.paused;$('previous').disabled=!current||queue.current===0;$('next').disabled=!current||queue.current===queue.jobs.length-1;
    $('retry').disabled=!current||!['ready','failed'].includes(current.status);$('redo-ocr').disabled=!current;$('page-number').textContent=current?`${queue.current+1} / ${queue.jobs.length} — ${current.name}`:'Nenhuma página';
    for(const id of ['mode','threads','provider','key','model','models','scope','filter-noise','allow-small'])$(id).disabled=!queue.paused;
    $('queue').replaceChildren();
    for(const job of queue.jobs){const button=document.createElement('button');button.textContent=`${job.index+1}. ${labels[job.status]}${job.result?.cacheHit?' · cache':''}`;button.setAttribute('aria-current',String(job.index===queue.current));button.onclick=()=>navigate(job.index);$('queue').append(button);}
    if(current&&shown===queue.current&&(renderedJob!==current||renderedRevision!==current.resultRevision||renderedStatus!==current.status))draw();
}
function draw(){
    const job=queue.jobs[queue.current];if(!bitmap||!job||shown!==queue.current)return;
    const result=job.result,paint=lettering.paint($('page'),bitmap,result?.segments||[],{translated:$('overlay').checked,fontReady,scale:Number($('font-scale').value)});
    renderedJob=job;renderedRevision=job.resultRevision;renderedStatus=job.status;
    $('image-status').textContent=job.status==='failed'?job.error:job.status==='ready'?`${paint.applied} balões traduzidos. ${result.cacheHit?'Resultado recuperado do cache.':`Preparação em ${(result.totalMs/1000).toFixed(1)} s.`}`:`${labels[job.status]}. Você pode ler o original enquanto a tradução é preparada.`;
    const quality=imageQuality(bitmap.width,bitmap.height);if(quality.small&&!$('image-status').textContent.includes(`${bitmap.width}×${bitmap.height}`))$('image-status').textContent+=` ${quality.message}`;
    const rasterScale=renderScale(bitmap.width,bitmap.height);if(rasterScale>1)$('image-status').textContent+=` Renderização ampliada automaticamente ${rasterScale.toFixed(1)}×.`;
    $('dialogue').replaceChildren();
    for(const segment of result?.segments||[]){const article=document.createElement('article'),source=document.createElement('small'),translation=document.createElement('p');source.textContent=segment.sourceText;translation.textContent=segment.translation||segment.translationError||(queue.paused?'Tradução pausada; continue a fila.':'Aguardando tradução');article.append(source,translation);if(segment.translationCandidate){const rejected=document.createElement('small');rejected.textContent=`Resposta recusada: ${segment.translationCandidate}`;article.append(rejected);}$('dialogue').append(article);}
    for(const [index,segment] of (result?.segments||[]).entries()){const note=paint.notes.get(segment.id);if(segment.translation&&note&&!note.startsWith('Tradução aplicada')){const info=document.createElement('small');info.textContent=`Na imagem: ${note}. A tradução completa está no painel.`;$('dialogue').children[index].append(info);}}
    if(result?.ignoredSegments?.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${result.ignoredSegments.length} trechos ignorados — conferir OCR`;details.append(summary);for(const segment of result.ignoredSegments){const p=document.createElement('p');p.textContent=`${segment.sourceText||'(vazio)'} — ${segment.reason}`;details.append(p);}$('dialogue').append(details);}
    $('speak').disabled=!result?.segments.some(s=>s.translation.trim());
}
async function navigate(index){
    window.speechSynthesis?.cancel();const revision=++drawRevision,job=queue.jobs[index];if(!job)return;
    shown=-1;queue.setCurrent(index);$('image-status').textContent='Carregando página…';
    try{const blob=await blobFor(job),image=await createImageBitmap(blob);if(revision!==drawRevision){image.close();return;}bitmap?.close();bitmap=image;shown=index;draw();}
    catch(error){if(revision===drawRevision)$('image-status').textContent=`Não foi possível abrir a imagem: ${error.message}`;}
}
function openPages(pages){
    queue.pause();engine.stop();blobs.clear();drawRevision++;bitmap?.close();bitmap=null;shown=-1;renderedJob=null;queue.setPages(pages);queue.setAhead($('ahead').value==='all'?Infinity:Number($('ahead').value));void navigate(0);
}
$('files').onchange=()=>{
    const collator=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'}),files=[...$('files').files].sort((a,b)=>collator.compare(a.name,b.name));
    openPages(files.map((file,index)=>({id:`local:${index}`,name:file.name,file})));
};
function readSettings(){
    settings={mode:$('mode').value,threads:Number($('threads').value),provider:$('provider').value,key:$('key').value,model:$('model').value,scope:$('scope').value,filterNoise:$('filter-noise').checked,allowSmallImages:$('allow-small').checked};
    if(settings.provider==='gemini'&&(!settings.key.trim()||!settings.model)){$('queue-status').textContent='Informe a chave e carregue um modelo Gemini.';return false;}
    return true;
}
$('start').onclick=()=>{if(readSettings()){persist();queue.start({retryFailed:true});}};
$('pause').onclick=()=>queue.pause();$('retry').onclick=()=>{if(readSettings())queue.retry(queue.current,{forceTranslate:queue.jobs[queue.current]?.status==='ready'});};
$('redo-ocr').onclick=()=>{if(readSettings())queue.retry(queue.current,{forceOCR:true});};
$('ahead').onchange=()=>queue.setAhead($('ahead').value==='all'?Infinity:Number($('ahead').value));
$('previous').onclick=()=>navigate(queue.current-1);$('next').onclick=()=>navigate(queue.current+1);$('overlay').onchange=draw;$('font-scale').onchange=draw;
$('provider').onchange=()=>{$('gemini').hidden=$('provider').value!=='gemini';};
$('key').oninput=()=>{modelsRevision++;$('model').replaceChildren(new Option('Carregue os modelos',''));persist();};
$('models').onclick=async()=>{
    const revision=++modelsRevision,previous=$('model').value;
    $('models').disabled=true;$('model-status').textContent='Consultando modelos…';
    try{const models=await listGeminiModels($('key').value,AbortSignal.timeout(30000)),recommended=['gemini-3.1-flash-lite','gemini-3.5-flash-lite'].find(id=>models.some(m=>m.id===id));if(revision!==modelsRevision)return;$('model').replaceChildren();for(const m of models)$('model').append(new Option(`${m.label}${m.id===recommended?' — recomendado por custo conhecido':''}`,m.id));if(models.some(m=>m.id===previous))$('model').value=previous;else if(recommended)$('model').value=recommended;$('model-status').textContent='A disponibilidade para tradução depende da conta e da cota.';persist();}
    catch(error){if(revision===modelsRevision)$('model-status').textContent=error.message;}finally{$('models').disabled=!queue.paused;}
};
$('forget-key').onclick=()=>{queue.pause();if(settings)settings.key='';$('key').value='';$('remember-key').checked=false;modelsRevision++;$('model').replaceChildren(new Option('Carregue os modelos',''));persist();};
function persist(){
    const values={};for(const id of ['mode','threads','ahead','provider','model','server','chapter-link','font-scale','scope'])values[id]=$(id).value;
    values.overlay=$('overlay').checked;values.filterNoise=$('filter-noise').checked;values.allowSmallImages=$('allow-small').checked;values.rememberKey=$('remember-key').checked;values.key=$('key').value;
    if(!savePreferences(values))$('model-status').textContent='O navegador não permitiu salvar as preferências.';
}
const saved=loadPreferences();
for(const id of ['mode','threads','ahead','provider','server','chapter-link','font-scale','scope'])if(typeof saved[id]==='string')$(id).value=saved[id];
if(saved.model){$('model').append(new Option(`${saved.model} — salvo`,saved.model));$('model').value=saved.model;}
if(typeof saved.overlay==='boolean')$('overlay').checked=saved.overlay;
if(typeof saved.filterNoise==='boolean')$('filter-noise').checked=saved.filterNoise;
if(typeof saved.allowSmallImages==='boolean')$('allow-small').checked=saved.allowSmallImages;
if(typeof saved.rememberKey==='boolean')$('remember-key').checked=saved.rememberKey;
if(saved.rememberKey&&typeof saved.key==='string')$('key').value=saved.key;
$('gemini').hidden=$('provider').value!=='gemini';
for(const id of ['mode','threads','ahead','provider','model','server','chapter-link','font-scale','scope','overlay','filter-noise','allow-small','remember-key'])$(id).addEventListener('change',persist);
$('clear-cache').onclick=async()=>{queue.pause();await engine.cache.clear();$('queue-status').textContent='Resultados salvos apagados; páginas já abertas permanecem nesta sessão.';};
$('library').onclick=async()=>{
    serverController?.abort();const controller=new AbortController();serverController=controller;$('server-status').textContent='Carregando biblioteca…';
    try{const mangas=await library($('server').value,controller.signal);if(controller.signal.aborted)return;$('manga').replaceChildren(new Option('Selecione uma obra',''));for(const manga of mangas)$('manga').append(new Option(manga.title,String(manga.id)));$('manga').disabled=!mangas.length;$('server-status').textContent=mangas.length?`${mangas.length} obras disponíveis.`:'Biblioteca vazia. Adicione uma HQ em inglês no Suwayomi e recarregue.';}
    catch(error){if(!controller.signal.aborted)$('server-status').textContent=`Falha no acesso: ${error.message}`;}
};
$('manga').onchange=async()=>{
    serverController?.abort();const controller=new AbortController();serverController=controller;$('chapter').replaceChildren(new Option('Selecione um capítulo',''));$('chapter').disabled=true;$('open-chapter').disabled=true;
    if(!$('manga').value)return;
    try{const rows=await chapters($('server').value,$('manga').value,controller.signal);if(controller.signal.aborted)return;rows.sort((a,b)=>a.chapterNumber-b.chapterNumber);for(const chapter of rows)$('chapter').append(new Option(chapter.name,String(chapter.id)));$('chapter').disabled=!rows.length;$('server-status').textContent=`${rows.length} capítulos.`;}
    catch(error){if(!controller.signal.aborted)$('server-status').textContent=error.message;}
};
$('chapter').onchange=()=>{$('open-chapter').disabled=!$('chapter').value;};
async function openRemote(server,id){
    serverController?.abort();const controller=new AbortController();serverController=controller;$('server-status').textContent='Buscando páginas…';
    try{const pages=await chapterPages(server,id,controller.signal);if(controller.signal.aborted)return;openPages(pages);$('server-status').textContent=`${pages.length} páginas abertas. Clique em Começar para preparar as traduções.`;}
    catch(error){if(!controller.signal.aborted)$('server-status').textContent=error.message;}
}
$('open-link').onclick=()=>{
    try{const url=new URL($('chapter-link').value),match=url.pathname.match(/\/manga\/\d+\/chapter\/(\d+)\/?$/);if(!match)throw new Error('Informe um link de capítulo do Suwayomi.');void openRemote(url.href,match[1]);}
    catch(error){$('server-status').textContent=error.message;}
};
$('open-chapter').onclick=async()=>{
    await openRemote($('server').value,$('chapter').value);
};
$('speak').onclick=()=>{window.speechSynthesis.cancel();const text=queue.jobs[queue.current]?.result?.segments.map(s=>s.translation).filter(Boolean).join('. ');if(text){const utterance=new SpeechSynthesisUtterance(text);utterance.lang='pt-BR';window.speechSynthesis.speak(utterance);}};
$('stop-speech').onclick=()=>window.speechSynthesis?.cancel();
loadLetteringFonts().then(()=>{fontReady=true;draw();}).catch(()=>{$('image-status').textContent='Fonte indisponível; tradução permanece nas falas.';});
window.addEventListener('pagehide',()=>{queue.pause();engine.stop();serverController?.abort();bitmap?.close();window.speechSynthesis?.cancel();settings=null;$('key').value='';});
