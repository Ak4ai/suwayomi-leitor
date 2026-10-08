import {Lettering,loadLetteringFonts,resolveLettering,styleLabel} from './lettering.js';
import {translate,translateMyMemory,listGeminiModels} from './translation.js';
const $=id=>document.getElementById(id);
let file,bitmap,result,worker,abort,busy=false,imageHash='';
const status=text=>{$('status').textContent=text;};
let modelsController=null,modelsRevision=0;
function resetModels(){
    modelsRevision++;modelsController?.abort();modelsController=null;
    $('model').replaceChildren(new Option('Informe a chave e carregue os modelos',''));
    $('model').disabled=true;$('load-models').disabled=false;
    $('models-status').textContent='Carregue os modelos disponíveis para esta chave.';
}
$('key').addEventListener('input',resetModels);
$('load-models').onclick=async()=>{
    if(busy)return;
    const previous=$('model').value;resetModels();
    const revision=modelsRevision,controller=new AbortController();modelsController=controller;
    const timeout=setTimeout(()=>controller.abort(),30000);
    $('load-models').disabled=true;$('models-status').textContent='Consultando modelos…';
    try{
        const models=await listGeminiModels($('key').value,controller.signal);
        if(revision!==modelsRevision)return;
        $('model').replaceChildren(new Option('Selecione um modelo',''));
        // Standard text prices checked 2026-09-29: USD per 1M input/output.
        // Exclude 2.5 Flash-Lite from recommendations: it returned unavailable
        // for this account. Unknown prices and moving aliases are not ranked.
        const economical=[{id:'gemini-3.1-flash-lite',input:.25,output:1.5},{id:'gemini-3.5-flash-lite',input:.30,output:2.5}];
        const recommended=economical.find(price=>models.some(m=>m.id===price.id));
        models.sort((a,b)=>Number(b.id===recommended?.id)-Number(a.id===recommended?.id));
        for(const model of models)$('model').append(new Option(`${model.label} — ${model.id}${model.id===recommended?.id?' — Recomendado: menor custo conhecido':''}`,model.id));
        $('model').disabled=!models.length;
        if(models.some(m=>m.id===previous))$('model').value=previous;
        else if(recommended)$('model').value=recommended.id;
        $('models-status').textContent=models.length?`${models.length} modelos Gemini para geração de texto listados. Selecione um; a tradução ainda depende da cota e da compatibilidade do modelo.`:'A API não retornou modelos Gemini de texto para este seletor.';
        if(recommended)$('models-status').textContent+=` Recomendação por custo: ${recommended.id}. Tarifa padrão: US$ ${recommended.input.toFixed(2)} de entrada e US$ ${recommended.output.toFixed(2)} de saída por milhão de tokens (consulta em 29/09/2026). Comparação entre modelos com preços conhecidos e sem indisponibilidade já identificada; acesso e cota ainda dependem da conta.`;
    }catch(error){if(revision===modelsRevision)$('models-status').textContent=error.name==='AbortError'?'A consulta excedeu o tempo limite. Tente novamente.':error.message;}
    finally{clearTimeout(timeout);if(revision===modelsRevision){modelsController=null;$('load-models').disabled=false;}}
};
function state(value){busy=value;$('translator').disabled=value;$('file').disabled=value;$('run').disabled=value||!bitmap;$('cancel').disabled=!value;for(const id of ['translate','export','speak'])$(id).disabled=value||!result?.segments.length;$('clear').disabled=value;for(const el of $('segments').querySelectorAll('button,textarea,select'))el.disabled=value;for(const select of $('segments').querySelectorAll('[data-style="weight"]'))if(select.dataset.fixed==='true')select.disabled=true;}
const lettering=new Lettering();
let fontReady=false;
loadLetteringFonts().then(()=>{fontReady=true;draw();}).catch(()=>{$('lettering-status').textContent='Não foi possível carregar as fontes. Atualize a página; a tradução continua disponível no painel.';});
function styleControls(card,segment){
    let controls=card.querySelector('.lettering-controls');
    if(!controls){
        controls=document.createElement('details');controls.className='lettering-controls';
        const summary=document.createElement('summary');summary.textContent='Estilo deste balão';controls.append(summary);
        const suggestion=document.createElement('p');suggestion.className='style-suggestion';controls.append(suggestion);
        const fields=[['family','Fonte',[['auto','Automática'],['comic','Comic Neue — arredondada'],['bangers','Bangers — estreita / traço forte']]],['weight','Espessura',[['auto','Automática'],['400','Regular'],['700','Negrito'],['900','Negrito reforçado']]],['slant','Inclinação',[['auto','Automática'],['normal','Normal'],['italic','Itálico']]]];
        for(const [field,label,choices] of fields){
            const l=document.createElement('label'),select=document.createElement('select');l.textContent=label;select.dataset.style=field;
            for(const [value,text] of choices)select.append(new Option(text,value));
            select.value=segment.letteringStyle?.[field]||'auto';
            select.onchange=()=>{segment.letteringStyle={...segment.letteringStyle,[field]:select.value};draw();};
            l.append(select);controls.append(l);
        }
        const reset=document.createElement('button');reset.textContent='Restaurar sugestão';reset.onclick=()=>{delete segment.letteringStyle;controls.querySelectorAll('select').forEach(s=>s.value='auto');draw();};controls.append(reset);
        const help=document.createElement('small');help.textContent='Ajuste aplicado ao balão inteiro. Bangers tem traço forte próprio; não oferece peso regular. A sugestão aproxima características, não identifica a fonte original.';controls.append(help);
        card.append(controls);
    }
    const suggested=lettering.region(segment).suggestion;
    segment.letteringSuggestion=suggested||null;
    controls.querySelector('.style-suggestion').textContent=suggested?.reliable?`Sugestão pela imagem: ${styleLabel(suggested)}. Baseada em ${suggested.glyphs} componentes de letras.`:'Sem evidência suficiente para sugerir estilo; usando Comic Neue em negrito reforçado como padrão.';
    controls.querySelectorAll('select,button').forEach(el=>el.disabled=busy);
    const weight=controls.querySelector('[data-style="weight"]');weight.dataset.fixed=String(resolveLettering(suggested,segment.letteringStyle).family==='bangers');weight.disabled=busy||weight.dataset.fixed==='true';
}
function draw(){
    if(!bitmap)return;
    const translated=$('overlay').checked;
    const outcome=lettering.paint($('canvas'),bitmap,result?.segments||[],{translated,fontReady,scale:Number($('font-scale').value)});
    $('lettering-status').textContent=translated?`${outcome.applied} balão(ões) com tradução aplicada. Regiões incertas ficam no original, com tradução no painel.`:'Exibindo a imagem original.';
    [...$('segments').children].forEach((card,index)=>{
        styleControls(card,result.segments[index]);
        let note=card.querySelector('.lettering-note');
        if(!note){note=document.createElement('p');note.className='lettering-note';card.append(note);}
        note.textContent=outcome.notes.get(result.segments[index].id)||'';
    });
}
$('font-scale').oninput=draw;

function render(){const list=$('segments');list.replaceChildren();for(const [index,s] of result.segments.entries()){const card=document.createElement('article'),title=document.createElement('h3');title.textContent=`Fala ${index+1}`;card.append(title);for(const [field,label] of [['sourceText','Inglês — revise antes de traduzir'],['translation','Português']]){const l=document.createElement('label'),t=document.createElement('textarea');l.textContent=label;t.value=s[field];t.addEventListener('input',()=>{s[field]=t.value;if(field==='sourceText'){s.translation='';card.querySelectorAll('textarea')[1].value='';}draw();});l.append(t);card.append(l);}const buttons=document.createElement('div');buttons.className='buttons';for(const [label,delta] of [['↑ Anterior',-1],['↓ Próxima',1]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{const target=index+delta;if(target<0||target>=result.segments.length)return;[result.segments[index],result.segments[target]]=[result.segments[target],result.segments[index]];render();};buttons.append(b);}const remove=document.createElement('button');remove.textContent='Excluir região';remove.onclick=()=>{result.segments.splice(index,1);render();state(false);};buttons.append(remove);card.append(buttons);list.append(card);}draw();}
$('file').onchange=async()=>{window.speechSynthesis?.cancel();bitmap?.close();bitmap=null;file=null;result=null;$('segments').replaceChildren();$('canvas').width=0;state(false);const candidate=$('file').files[0];if(!candidate)return;try{if(!['image/jpeg','image/png','image/webp'].includes(candidate.type)||candidate.size>15*1024*1024)throw new Error('Use JPG, PNG ou WebP de até 15 MB.');const loaded=await createImageBitmap(candidate);if(loaded.width*loaded.height>25e6){loaded.close();throw new Error('Use uma imagem de até 25 megapixels.');}bitmap=loaded;file=candidate;imageHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');draw();status(`${file.name} · ${bitmap.width} × ${bitmap.height}. Pronta para reconhecimento.`);}catch(e){status(e.message);}state(false);};
$('run').onclick=()=>{result=null;$('segments').replaceChildren();draw();state(true);status('Iniciando OCR local…');$('progress').value=0;const workerUrl=new URL('./worker.js',import.meta.url);workerUrl.searchParams.set('threads',$('threads').value);if(worker&&worker.threadSetting!==$('threads').value){worker.terminate();worker=null;}if(!worker){worker=new Worker(workerUrl,{type:'module'});worker.threadSetting=$('threads').value;}worker.onmessage=({data})=>{if(data.type==='progress'){status(data.message);if(Number.isFinite(data.progress))$('progress').value=data.progress;}if(data.type==='error'){status(data.message);worker.terminate();worker=null;state(false);}if(data.type==='result'){result={...data.result,imageHash,fileName:file.name};render();$('progress').value=1;status(`${result.segments.length} regiões em ${(result.elapsedMs/1000).toFixed(1)} s. Provedores: ${JSON.stringify(result.providers)}. ${result.fallbacks.join(' ')} ${result.metrics ? 'Inferencia (s): detector '+(result.metrics.inferenceMs.detector/1000).toFixed(2)+', linhas '+(result.metrics.inferenceMs.lines/1000).toFixed(2)+', leitura '+(result.metrics.inferenceMs.recognizer/1000).toFixed(2)+'.' : ''} Threads WASM: ${result.threads??1}. Modelos: ${result.reusedSessions?'reutilizados':'inicializados'} (${(result.initializationMs/1000).toFixed(1)} s).`);state(false);if(document.getElementById("auto-translate").checked && result.segments.some(s=>s.sourceText.trim()))void translatePage();}};worker.onerror=()=>{status('Não foi possível executar o worker. Confira o console e os arquivos do runtime.');worker.terminate();worker=null;state(false);};worker.postMessage({image:file,mode:$('mode').value});};
$('cancel').onclick=()=>{if(abort){abort.abort();return;}worker?.terminate();worker=null;state(false);status('Operação cancelada.');};
$('clear').onclick=async()=>{try{await caches.delete('ihc-ocr-models-v1');status('Cache dos modelos apagado. O próximo reconhecimento fará novo download.');}catch{status('Este navegador não permitiu apagar o cache.');}};
$('translator').onchange=()=>{const gemini=$('translator').value==='gemini';$('gemini-options').hidden=!gemini;$('translate').textContent=`Enviar textos ao ${gemini?'Gemini':'MyMemory'} e traduzir`;$('translation-info').textContent=gemini?'Gemini envia apenas as falas e seus identificadores ao Google. A API pode ter cobrança e limites na sua conta. A chave não é salva nem exportada.':'MyMemory envia apenas as falas ao serviço externo, sem a imagem e sem chave. Precisa de internet, tem limite de uso e traduz cada fala separadamente; revise o português.';};
async function translatePage(){
    if(busy||!result)return;
    if($('translator').value==='gemini'&&!$('model').value){status('Carregue os modelos com sua chave Gemini e selecione um antes de traduzir.');return;}
    state(true);window.speechSynthesis?.cancel();abort=new AbortController();
    const provider=$('translator').value,timer=setTimeout(()=>abort?.abort(),120000);
    status(`Enviando as falas revisadas ao ${provider==='gemini'?'Gemini':'MyMemory'}…`);
    try{
        const translated=provider==='gemini'
            ?await translate(result.segments,$('key').value,$('model').value.trim(),abort.signal)
            :await translateMyMemory(result.segments,abort.signal,status,(id,value)=>{const s=result.segments.find(s=>s.id===id);s.translation=value;s.translationProvider=provider;s.translatedSource=s.sourceText;render();state(true);});
        for(const s of result.segments){s.translation=translated.get(s.id)||'';s.translationProvider=provider;s.translatedSource=s.sourceText;}
        result.translationProvider=provider;render();
        let unchanged=0;
        $('segments').querySelectorAll('article').forEach((card,index)=>{
            const s=result.segments[index],normalize=text=>text.replace(/\s+/g,' ').trim().toLocaleLowerCase();
            if(s.sourceText.trim()&&normalize(s.sourceText)===normalize(s.translation)){
                unchanged++;const note=document.createElement('p');note.textContent='Revisar: o serviço devolveu o texto sem alteração. Pode ser um nome próprio ou uma fala não traduzida.';card.prepend(note);
            }
        });
        status(`Tradução concluída. ${unchanged?`${unchanged} trecho(s) sem alteração, sinalizado(s) para revisão. `:''}Revise o resultado antes de ouvir.`);
    }catch(e){
        if(provider==='gemini'&&e.httpStatus===404){
            const option=[...$('model').options].find(o=>o.value===e.model);
            if(option){option.disabled=true;option.textContent+=' — indisponível para esta chave';}
            if($('model').value===e.model)$('model').value='';
            $('models-status').textContent='O modelo recusou esta conta/endpoint e foi desabilitado nesta lista. Escolha outro. A listagem do Google não garante acesso.';
        }
        status(e.name==='AbortError'?'Tradução cancelada ou tempo limite atingido. Falas concluídas foram mantidas.':e.message);
    }
    finally{clearTimeout(timer);abort=null;state(false);}
};
$('translate').onclick=translatePage;
$('forget').onclick=()=>{$('key').value='';resetModels();status('Chave e lista de modelos apagadas desta página.');};
$('overlay').onchange=draw;
$('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ocr-web-resultado.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('speak').onclick=()=>{if(!('speechSynthesis'in window)){status('Síntese de voz indisponível neste navegador.');return;}speechSynthesis.cancel();const text=result.segments.map(s=>s.translation).filter(Boolean).join('\n');if(!text){status('Traduza ou preencha os textos em português primeiro.');return;}const speech=new SpeechSynthesisUtterance(text);speech.lang='pt-BR';speech.onerror=()=>status('Não foi possível reproduzir a voz. Confira as vozes do aparelho.');speechSynthesis.speak(speech);};
$('stop').onclick=()=>window.speechSynthesis?.cancel();
window.addEventListener('pagehide',()=>{worker?.terminate();abort?.abort();modelsController?.abort();window.speechSynthesis?.cancel();$('key').value='';resetModels();});
