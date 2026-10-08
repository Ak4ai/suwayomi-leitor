import * as ort from './vendor/ort.webgpu.min.mjs';
import {suppress,clampBox,decodeCTC,lineComponents,associateBubble,limitLineOverlap,removeTinyLines,mergeLineFragments} from './vision.js';
ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
const requestedThreads=Number(new URL(self.location.href).searchParams.get('threads'));
const threads=self.crossOriginIsolated&&[2,4].includes(requestedThreads)?requestedThreads:1;
ort.env.wasm.numThreads=threads;
ort.env.logLevel='warning';
let manifest,sessionMode,busy=false,metrics;
const sessions=new Map(), providers={}, fallbacks=[];
const status=(message,progress)=>self.postMessage({type:'progress',message,progress});
const hex=buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');

async function modelBytes(role) {
    const spec=manifest.models[role],url=new URL(spec.url,import.meta.url).href;
    let cache;
    try {cache=await caches.open('ihc-ocr-models-v1');} catch {status('Cache indisponível; usando memória nesta sessão.');}
    const cached=await cache?.match(url);
    if (cached) {
        const buffer=await cached.arrayBuffer();
        if (hex(await crypto.subtle.digest('SHA-256',buffer))===spec.sha256) return buffer;
        await cache.delete(url);
    }
    status(`Baixando ${role}: ${(spec.bytes/1e6).toFixed(1)} MB…`);
    const response=await fetch(url);
    if (!response.ok) throw new Error(`Não foi possível baixar ${role} (HTTP ${response.status}).`);
    const reader=response.body.getReader(),chunks=[];let total=0;
    while (true) {
        const {done,value}=await reader.read();if(done)break;
        chunks.push(value);total+=value.length;
        status(`Baixando ${role}: ${(total/1e6).toFixed(1)} / ${(spec.bytes/1e6).toFixed(1)} MB`,Math.min(1,total/spec.bytes));
    }
    const data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
    if(hex(await crypto.subtle.digest('SHA-256',data))!==spec.sha256)throw new Error(`Checksum inválido: ${role}. Tente baixar novamente.`);
    try {await cache?.put(url,new Response(data));} catch {status('Sem espaço para salvar o modelo; usando memória.');}
    return data.buffer;
}
async function initialize(role,mode) {
    const useGPU=(mode==='auto'||mode===`${role}-gpu`) && !!navigator.gpu && !!(await navigator.gpu.requestAdapter());
    const requested=useGPU ? ['webgpu','wasm']:['wasm'];
    const bytes=await modelBytes(role);
    status(`Inicializando ${role} (${requested.join(' + ')})…`);
    try {
        const session=await ort.InferenceSession.create(bytes,{executionProviders:requested,graphOptimizationLevel:'all'});
        sessions.set(role,session);providers[role]=requested;return session;
    } catch(error) {
        if(!useGPU)throw error;
        fallbacks.push(`${role}: inicialização WebGPU incompatível; usando WASM.`);
        const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
        sessions.set(role,session);providers[role]=['wasm'];return session;
    }
}
async function infer(role,feeds) {
    const started=performance.now();
    metrics.calls[role]++;
    try {return await sessions.get(role).run(feeds);}
    catch(error) {
        if(!providers[role].includes('webgpu'))throw error;
        fallbacks.push(`${role}: falha na execução WebGPU; nova tentativa em WASM.`);
        await sessions.get(role).release();sessions.delete(role);
        await initialize(role,'wasm');return await sessions.get(role).run(feeds);
    }
    finally{metrics.inferenceMs[role]+=performance.now()-started;}
}
function canvasImage(image,box,width,height) {
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='white';ctx.fillRect(0,0,width,height);
    ctx.drawImage(image,...[box[0],box[1],box[2]-box[0],box[3]-box[1]],0,0,width,height);
    return ctx.getImageData(0,0,width,height).data;
}
function tensorImage(image,box,width,height,{bgr=false,normalized=false,padWidth=width}={}) {
    const pixels=canvasImage(image,box,width,height),data=new Float32Array(3*padWidth*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++) {
        const value=pixels[(y*width+x)*4+(bgr?2-c:c)]/255;
        data[c*padWidth*height+y*padWidth+x]=normalized ? (value-.5)/.5:value;
    }
    return new ort.Tensor('float32',data,[1,3,height,padWidth]);
}
function dispose(tensors) {for(const tensor of Object.values(tensors))tensor.dispose();}

self.onmessage=async ({data:job})=>{
    if(busy)return;
    busy=true;
    const targetedPadding=job.targetedPadding!==false;
    let image;
    try {
        const started=performance.now();
        metrics={inferenceMs:{detector:0,lines:0,recognizer:0},calls:{detector:0,lines:0,recognizer:0}};
        manifest??=await (await fetch('./models.json')).json();
        const reusedSessions=sessionMode===job.mode&&sessions.size===3;
        if(sessionMode!==job.mode){
            for(const session of sessions.values())await session.release().catch(()=>{});
            sessions.clear();fallbacks.length=0;sessionMode=job.mode;
        }
        for(const role of ['detector','lines','recognizer'])if(!sessions.has(role))await initialize(role,job.mode);
        const initializationMs=performance.now()-started;
        image=await createImageBitmap(job.image);
        const width=image.width,height=image.height,full=[0,0,width,height];
        status('Localizando balões e regiões de texto…');
        const feeds={images:tensorImage(image,full,640,640),orig_target_sizes:new ort.Tensor('int64',BigInt64Array.from([BigInt(width),BigInt(height)]),[1,2])};
        const output=await infer('detector',feeds);
        const [labels,boxes,scores]=sessions.get('detector').outputNames.map(name=>output[name].data);
        const regions=[],bubbles=[];
        for(let i=0;i<scores.length;i++) {
            if(scores[i]<.3)continue;
            const region={box:clampBox(Array.from(boxes.slice(i*4,i*4+4)),width,height),score:scores[i],kind:Number(labels[i])===0?'bubble':Number(labels[i])===1?'bubble-text':'free-text'};
            if(Number(labels[i])===0)bubbles.push(region);
            else if([1,2].includes(Number(labels[i])))regions.push(region);
        }
        dispose(output);dispose(feeds);
        const textRegions=suppress(regions).filter(r=>r.box[2]-r.box[0]>4 && r.box[3]-r.box[1]>4).sort((a,b)=>a.box[1]-b.box[1] || a.box[0]-b.box[0]);
        const segments=[];
        for(let i=0;i<textRegions.length;i++) {
            const region=textRegions[i],box=region.box,w=box[2]-box[0],h=box[3]-box[1];
            status(`Reconhecendo região ${i+1} de ${textRegions.length}…`,i/textRegions.length);
            const scale=Math.min(2,960/Math.max(w,h)),dw=Math.max(32,Math.round(w*scale/32)*32),dh=Math.max(32,Math.round(h*scale/32)*32);
            const lineInput=tensorImage(image,box,dw,dh,{bgr:true,normalized:true});
            const lineOutput=await infer('lines',{[sessions.get('lines').inputNames[0]]:lineInput});
            const map=lineOutput[sessions.get('lines').outputNames[0]];
            const candidates=lineComponents(map.data,map.dims.at(-1),map.dims.at(-2),w,h);
            const merged=job.lineMerge!==false&&(!targetedPadding||region.kind==='bubble-text')?mergeLineFragments(candidates):candidates;
            const lines=job.lineClip?limitLineOverlap(merged):removeTinyLines(merged);
            dispose(lineOutput);lineInput.dispose();
            const recognized=[];
            for(const line of lines) {
                const absolute=[line.box[0]+box[0],line.box[1]+box[1],line.box[2]+box[0],line.box[3]+box[1]];
                if(job.recPadding){const padding=(absolute[3]-absolute[1])*Math.min(.3,Math.max(0,Number(job.recPadding)));absolute[0]=Math.max(box[0],Math.floor(absolute[0]-padding));absolute[2]=Math.min(box[2],Math.ceil(absolute[2]+padding));}
                const rw=Math.max(8,Math.min(2048,Math.ceil(48*(absolute[2]-absolute[0])/Math.max(1,absolute[3]-absolute[1]))));
                const input=tensorImage(image,absolute,rw,48,{bgr:true,normalized:true,padWidth:Math.max(320,rw)});
                const output=await infer('recognizer',{[sessions.get('recognizer').inputNames[0]]:input});
                const values=output[sessions.get('recognizer').outputNames[0]];
                let result=decodeCTC(values.data,values.dims,manifest.characters);
                dispose(output);input.dispose();
                if(targetedPadding&&region.kind==='bubble-text'&&(/(?<!\.)\.{2}(?!\.)|_/.test(result.text)||(line.hadFragments&&/^\./.test(result.text)))){
                    const padding=(absolute[3]-absolute[1])*.2,expanded=[Math.max(box[0],Math.floor(absolute[0]-padding)),absolute[1],Math.min(box[2],Math.ceil(absolute[2]+padding)),absolute[3]];
                    const retryWidth=Math.max(8,Math.min(2048,Math.ceil(48*(expanded[2]-expanded[0])/Math.max(1,expanded[3]-expanded[1]))));
                    const retryInput=tensorImage(image,expanded,retryWidth,48,{bgr:true,normalized:true,padWidth:Math.max(320,retryWidth)});
                    const retryOutput=await infer('recognizer',{[sessions.get('recognizer').inputNames[0]]:retryInput});
                    const retryValues=retryOutput[sessions.get('recognizer').outputNames[0]],candidate=decodeCTC(retryValues.data,retryValues.dims,manifest.characters);
                    dispose(retryOutput);retryInput.dispose();
                    const letters=text=>text.toUpperCase().replace(/[^A-Z0-9]/g,'');
                    const penalty=text=>(text.match(/(?<!\.)\.{2}(?!\.)/g)||[]).length*2+(text.match(/_/g)||[]).length*2+(line.hadFragments&&/^\./.test(text)?2:0);
                    if(letters(candidate.text)===letters(result.text)&&penalty(candidate.text)<penalty(result.text)&&candidate.confidence>=result.confidence*.85){result={...candidate,punctuationRetry:true};absolute.splice(0,4,...expanded);}
                }
                if(result.text)recognized.push({...result,box:absolute});
            }
            const containing=associateBubble(box,bubbles);
            segments.push({id:`s${i+1}`,box,bubble:containing?.box || null,textKind:region.kind,sourceText:recognized.map(r=>r.text).join('\n'),translation:'',lines:recognized,detectionConfidence:region.score});
            self.postMessage({type:'segment',segment:segments.at(-1)});
        }
        const elapsedMs=performance.now()-started;
        metrics.otherMs=elapsedMs-initializationMs-Object.values(metrics.inferenceMs).reduce((a,b)=>a+b,0);
        self.postMessage({type:'result',result:{segments,detections:{textRegions,bubbles},width,height,elapsedMs,initializationMs,metrics,reusedSessions,threads,providers,fallbacks,
            pipelineVersion:manifest.pipelineVersion,runtimeVersion:manifest.runtimeVersion,models:manifest.models,
            note:'WebGPU + WASM indica provedores configurados; não garante todos os nós na GPU. Linhas horizontais com pós-processamento aproximado. Ordem geométrica; revise a sequência.'}});
    }catch(error){self.postMessage({type:'error',message:`Falha no OCR local: ${error.message || String(error)}. Tente o modo WASM.`});}
    finally{image?.close();busy=false;}
};
