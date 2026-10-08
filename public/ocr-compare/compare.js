import { metrics } from './metrics.js';
const $ = (id) => document.getElementById(id);
let methods = [], file, bitmap, imageHash, busy = false, stop = false;
let results = [];
const percent = (value) => value == null ? '—' : `${(value*100).toFixed(1)}%`;
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function lock(value) {
    busy = value;
    for (const id of ['image','run','import','reference','allow-cloud']) $(id).disabled = value || (['run','import'].includes(id) && !file);
    for (const input of document.querySelectorAll('#methods input')) input.disabled = value || !methods.find(m => m.id === input.value).ready;
    $('stop').disabled = !value;
}
async function loadMethods() {
    try {
        const response = await fetch('/api/methods');
        if (!response.ok) throw new Error('Falha ao carregar métodos.');
        methods = await response.json();
        $('methods').replaceChildren();
        for (const method of methods) {
            const label = document.createElement('label'), input = document.createElement('input');
            input.type = 'checkbox'; input.value = method.id;
            input.checked = method.ready && method.kind !== 'cloud'; input.disabled = !method.ready;
            label.append(input, document.createTextNode(` ${method.name} — ${method.ready ? (method.kind === 'cloud' ? 'nuvem' : 'local') : 'não configurado'}`));
            $('methods').append(label);
        }
    } catch (e) { error(e.message); }
}
function render() {
    $('rows').replaceChildren(); $('outputs').replaceChildren();
    const previousOverlay = $('overlay').value;
    $('overlay').replaceChildren(new Option('Somente imagem', ''));
    results.forEach((result,index) => {
        result.metrics = result.status === 'ok' ? metrics($('reference').value,result.text) : null;
        const row = document.createElement('tr');
        for (const value of [result.name, result.status === 'ok' ? (result.external ? 'Importado' : 'Concluído') : result.status,
            result.wallMs == null ? '—' : `${(result.wallMs/1000).toFixed(2)} s`,percent(result.metrics?.cer),percent(result.metrics?.wer)]) {
            const td = document.createElement('td'); td.textContent = value; row.append(td);
        }
        $('rows').append(row);
        const detail = document.createElement('details'), title = document.createElement('summary');
        title.textContent = result.name; detail.append(title);
        const info = document.createElement('p'); info.textContent = result.error || `${result.model || ''}. ${result.notes || ''}`; detail.append(info);
        if (result.status === 'ok') {
            const text = document.createElement('pre'); text.textContent = result.text || '(Nenhum texto reconhecido)'; detail.append(text);
            if (result.metrics?.unavailable) { const note = document.createElement('p'); note.textContent = result.metrics.unavailable; detail.append(note); }
            if (result.regions?.length) $('overlay').append(new Option(result.name,String(index)));
        }
        $('outputs').append(detail);
    });
    $('overlay').value = previousOverlay;
    $('export').disabled = !results.length;
    draw();
}
function draw() {
    if (!bitmap) return;
    const canvas = $('canvas'), ctx = canvas.getContext('2d');
    canvas.width = bitmap.width; canvas.height = bitmap.height; ctx.drawImage(bitmap,0,0);
    const result = $('overlay').value === '' ? null : results[Number($('overlay').value)];
    ctx.strokeStyle = '#fc225d'; ctx.lineWidth = Math.max(2,bitmap.width/500);
    ctx.font = `bold ${Math.max(16,bitmap.width/65)}px sans-serif`;
    (result?.regions || []).forEach((region,index) => {
        const [x1,y1,x2,y2] = region.box;
        ctx.strokeRect(x1,y1,x2-x1,y2-y1); ctx.fillStyle = '#ffdf3f'; ctx.fillText(String(index+1),x1,Math.max(20,y1));
    });
}
$('image').addEventListener('change',async () => {
    const candidate = $('image').files[0]; if (!candidate) return;
    $('error').hidden = true;
    lock(true);
    try {
        if (!['image/png','image/jpeg','image/webp'].includes(candidate.type) || candidate.size > 15*1024*1024) throw new Error('Use PNG/JPEG/WebP de até 15 MB.');
        const loaded = await createImageBitmap(candidate);
        if (loaded.width*loaded.height > 25000000) { loaded.close(); throw new Error('Limite: 25 milhões de pixels.'); }
        const hash = await crypto.subtle.digest('SHA-256',await candidate.arrayBuffer());
        bitmap?.close(); bitmap = loaded; file = candidate;
        imageHash = Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
        results = []; $('reference').value = ''; $('external-text').value = '';
        $('image-info').textContent = `${file.name} · ${bitmap.width} × ${bitmap.height} · SHA-256 ${imageHash.slice(0,12)}…`;
        $('status').textContent = 'Imagem pronta. Selecione os métodos e compare.';
        render();
    } catch(e) { error(e.message); }
    finally { lock(false); }
});
async function tesseract() {
    if (!window.Tesseract) throw new Error('Tesseract não carregou. Verifique a conexão e recarregue.');
    let worker;
    try {
        worker = await Tesseract.createWorker('eng',1,{logger:({status,progress})=>{
            if (status === 'recognizing text') $('status').textContent = `Tesseract: ${Math.round(progress*100)}%`;
        }});
        await worker.setParameters({tessedit_pageseg_mode:'11'});
        const {data} = await worker.recognize(file,{}, {text:true,blocks:true});
        const regions = (data.blocks || []).flatMap(block=>(block.paragraphs || []).flatMap(p=>(p.lines || []).map(line=>({
            text:line.text,box:[line.bbox.x0,line.bbox.y0,line.bbox.x1,line.bbox.y1],confidence:line.confidence/100,
        }))));
        return {text:data.text,regions,model:'Tesseract.js 6.0.1 / eng / PSM 11',notes:'Página inteira, sem recortes; tempo inclui criação do worker e eventual download.',imageSha256:imageHash};
    } finally { if (worker) await worker.terminate(); }
}
$('run').addEventListener('click',async () => {
    if (busy || !file) return;
    const selected = methods.filter(m => document.querySelector(`#methods input[value="${m.id}"]`).checked);
    if (!selected.length) { error('Selecione pelo menos um método.'); return; }
    if (selected.some(m=>m.kind === 'cloud') && !$('allow-cloud').checked) { error('Para executar os serviços selecionados, habilite o envio à nuvem.'); return; }
    lock(true); stop = false; $('error').hidden = true;
    try {
        for (const method of selected) {
            if (stop) break;
            const item = {method:method.id,name:method.name,status:'Executando',imageSha256:imageHash,startedAt:new Date().toISOString()};
            results.push(item); render(); $('status').textContent = `Executando ${method.name}…`;
            const start = performance.now();
            try {
                let output;
                if (method.id === 'tesseract') output = await tesseract();
                else {
                    const response = await fetch(`/api/run/${method.id}`,{method:'POST',headers:{'Content-Type':file.type,'X-OCR-Compare':'1','X-Allow-Cloud':$('allow-cloud').checked ? '1':'0'},body:file});
                    output = await response.json();
                    if (!response.ok) throw new Error(output.error || `HTTP ${response.status}`);
                }
                Object.assign(item,output,{status:'ok'});
            } catch(e) { item.status = 'Erro'; item.error = e.message; }
            item.wallMs = performance.now()-start; render();
        }
        $('status').textContent = stop ? 'Fila interrompida após concluir o método atual.' : 'Comparação concluída. Abra cada resultado e examine as regiões.';
    } finally { lock(false); }
});
$('stop').addEventListener('click',()=>{stop=true;$('stop').disabled=true;$('status').textContent='Aguardando o método atual terminar; os próximos não serão executados.';});
$('reference').addEventListener('change',render);
$('overlay').addEventListener('change',draw);
$('import').addEventListener('click',()=>{
    const text = $('external-text').value.trim();
    if (!file || !text || busy) { error('Carregue a imagem e cole a transcrição externa.'); return; }
    results.push({method:'external',name:$('external-method').value,model:$('external-version').value,text,regions:[],status:'ok',external:true,
        imageSha256:imageHash,notes:'Importação manual: associação à imagem informada pelo usuário; não verificada pelo servidor.',startedAt:new Date().toISOString()});
    render();
});
$('export').addEventListener('click',()=>{
    render();
    const report = {schemaVersion:1,createdAt:new Date().toISOString(),image:{name:file.name,sha256:imageHash,width:bitmap.width,height:bitmap.height},
        reference:$('reference').value,normalization:'NFKC, uppercase, non letters/numbers to spaces, trim; CER includes normalized spaces; order-sensitive',results};
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='comparativo-ocr.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
await loadMethods();
