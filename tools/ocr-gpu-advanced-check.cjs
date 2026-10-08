const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  for(const name of ['gpu-advanced-worker.js','gpu-ctc.js'])await page.route(`**/${name}`,r=>r.fulfill({path:path.join(__dirname,name),contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'}}));
  await page.route('**/experimental/recognizer-fp16.onnx',r=>r.fulfill({path:path.join(root,'.ocr-models/experimental/recognizer-fp16.onnx'),contentType:'application/octet-stream',headers:{'Cross-Origin-Resource-Policy':'same-origin'}}));
  for(const name of ['tiny.onnx','small.onnx','tiny-dict.txt','small-dict.txt'])await page.route(`**/experimental/${name}`,r=>r.fulfill({path:path.join(root,'.ocr-models/experimental/v6',name),contentType:name.endsWith('onnx')?'application/octet-stream':'text/plain; charset=utf-8'}));
  await page.route('**/advanced-fixture.jpg',r=>r.fulfill({path:path.resolve(root,'../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');
  await page.exposeFunction('advancedProgress',data=>console.log(JSON.stringify(data)));
  const extra=process.argv.includes('--capture-one-shape');
  const fp16Only=process.argv.includes('--fp16');
  const v6Only=process.argv.includes('--v6');
  const selected=extra?['fp32-sequential','fp32-capture','fp32-capture-one-shape']:fp16Only?['fp32-sequential','fp16-sequential','fp16-gpu-ctc']:v6Only?['v5-wasm','v6-tiny-wasm','v6-small-wasm','v6-tiny-gpu']:undefined;
  const report=await page.evaluate(async variants=>{
   const adapter=await navigator.gpu?.requestAdapter(),environment={userAgent:navigator.userAgent,shaderF16:adapter?.features.has('shader-f16'),isolated:crossOriginIsolated};
   const image=await(await fetch('./advanced-fixture.jpg')).blob(),worker=new Worker('./gpu-advanced-worker.js',{type:'module'});
   try{return {environment,reports:await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Advanced tests timed out')),900000);
    worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};
    worker.onmessage=({data})=>{if(data.type==='progress')void window.advancedProgress(data);if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.reports);}};
    worker.postMessage({image,variants});
   })};}finally{worker.terminate();}
  },selected);
  const baseline=report.reports[0].runs.at(-1);
  const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.ceil((sorted.length-1)/2)])/2;};
  report.summary=report.reports.map(r=>{
   const warm=r.runs.slice(1),diffs=r.runs.flatMap(run=>run.texts.flatMap((t,i)=>t.text===baseline.texts[i].text?[]:[{iteration:run.iteration,line:i,baseline:baseline.texts[i].text,actual:t.text}]));
   for(const run of r.runs)assert.deepEqual(run.boxes,baseline.boxes);
   const last=r.runs.at(-1);
   const maxConfidenceDifference=r.runs.reduce((max,run)=>Math.max(max,...run.texts.map((t,i)=>Math.abs(t.confidence-baseline.texts[i].confidence))),0);
   return {variant:r.variant,supported:r.supported,matchesReference:r.runs.length>0&&diffs.length===0,error:r.error,warmMedianMs:warm.length?median(warm.map(x=>x.totalMs)):null,recognitionMedianMs:warm.length?median(warm.map(x=>x.recognitionTotalMs)):null,rangeMs:warm.length?[Math.min(...warm.map(x=>x.totalMs)),Math.max(...warm.map(x=>x.totalMs))]:null,textDifferences:diffs,maxConfidenceDifference,lines:last?.texts.length,calls:last?.calls,downloadBytes:last?.downloadBytes,probabilityBytes:last?.probabilityBytes,inputBufferBytes:last?.allocatedInputBytes,sessions:last?.sessions,initializationMs:r.initializationMs};
  });
  if(v6Only){
   const reference=JSON.parse(await fs.readFile(path.join(__dirname,'fixtures/reference-7.json'),'utf8')),{score}=require('./ocr-fidelity-metrics.cjs');
   assert.deepEqual(baseline.boxes,reference.entries.map(e=>e.box));
   for(const summary of report.summary){const last=report.reports.find(r=>r.variant===summary.variant).runs.at(-1);if(last)summary.accuracy=score(reference.entries,last.texts.map((t,i)=>({id:reference.entries[i].id,...t})));}
  }
  await fs.writeFile(path.join(root,`ocr-runs/gpu-advanced${extra?'-one-shape':fp16Only?'-fp16':v6Only?'-v6':''}-check.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({environment:report.environment,summary:report.summary}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
