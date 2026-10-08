const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {score}=require('./ocr-fidelity-metrics.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),reference=JSON.parse(await fs.readFile(path.join(__dirname,'fixtures/reference-7.json'),'utf8')),imagePath=path.join(__dirname,'fixtures',reference.image);
 assert.equal(crypto.createHash('sha256').update(await fs.readFile(imagePath)).digest('hex'),reference.imageSha256);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  for(const name of ['ocr-fidelity-worker.js','gpu-ctc.js'])await page.route(`**/${name}`,r=>r.fulfill({path:path.join(__dirname,name),contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'}}));
  for(const name of ['tiny.onnx','small.onnx','tiny-dict.txt','small-dict.txt'])await page.route(`**/experimental/${name}`,r=>r.fulfill({path:path.join(root,'.ocr-models/experimental/v6',name),contentType:name.endsWith('onnx')?'application/octet-stream':'text/plain; charset=utf-8'}));
  await page.route('**/fidelity-fixture.jpg',r=>r.fulfill({path:imagePath,contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');await page.exposeFunction('fidelityProgress',data=>console.log(JSON.stringify(data)));
  const report=await page.evaluate(async entries=>{
   const adapter=await navigator.gpu?.requestAdapter(),environment={userAgent:navigator.userAgent,isolated:crossOriginIsolated,gpuAvailable:!!adapter},image=await(await fetch('./fidelity-fixture.jpg')).blob(),worker=new Worker('./ocr-fidelity-worker.js',{type:'module'});
   try{return {environment,reports:await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Recognition comparison timed out')),1800000);
    worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};worker.onmessage=({data})=>{if(data.type==='progress')void window.fidelityProgress(data);if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.reports);}};worker.postMessage({image,entries});
   })};}finally{worker.terminate();}
  },reference.entries);
  report.reference=reference;report.models=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/v6-models.json'),'utf8'));
  const median=values=>{const a=values.toSorted((a,b)=>a-b);return(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
  report.summary=[];
  for(const name of ['v5-en','v6-tiny','v6-small'])for(const mode of ['wasm','gpu','gpu-ctc']){
   const rows=report.reports.filter(r=>r.name===name&&r.mode===mode),runs=rows.flatMap(r=>r.runs),warm=rows.flatMap(r=>r.runs.slice(1));
   const scores=runs.map(run=>score(reference.entries,run.texts));
   report.summary.push({name,mode,supported:rows.every(r=>r.supported),errors:rows.filter(r=>r.error).map(r=>r.error),warmRuns:warm.length,medianMs:warm.length?median(warm.map(r=>r.elapsedMs)):null,rangeMs:warm.length?[Math.min(...warm.map(r=>r.elapsedMs)),Math.max(...warm.map(r=>r.elapsedMs))]:null,initializationMs:rows.map(r=>r.initializationMs),bytes:rows[0]?.bytes,characters:rows[0]?.characterCount,accuracy:scores.at(-1),contentAccuracy:runs.length?score(reference.entries,runs.at(-1).texts,true):null,dialogueAccuracy:runs.length?score(reference.entries.filter(e=>e.category==='dialogue'),runs.at(-1).texts):null,stableText:runs.every(r=>JSON.stringify(r.texts.map(t=>t.text))===JSON.stringify(runs[0].texts.map(t=>t.text))),downloadBytes:runs.at(-1)?.downloadBytes});
  }
  await fs.writeFile(path.join(root,'ocr-runs/recognition-fidelity-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.summary));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
