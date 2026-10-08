const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const prior=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/provider-check.json'),'utf8'));
 const reference=prior.runs.find(r=>r.mode==='auto');
 const boxes=reference.segments.flatMap(s=>s.lines.map(line=>line.box));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/gpu-fixture.jpg',r=>r.fulfill({path:path.resolve(root,'../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.route('**/gpu-recognizer-worker.js',r=>r.fulfill({path:path.join(__dirname,'gpu-recognizer-worker.js'),contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'}}));
  await page.goto('http://127.0.0.1:3003');
  await page.exposeFunction('reportProgress',batch=>console.log('Completed batch size '+batch));
  const captureOnly=process.argv.includes('--capture');
  const output=await page.evaluate(async ({boxes,captureOnly})=>{
   const image=await(await fetch('./gpu-fixture.jpg')).blob();
   const worker=new Worker('./gpu-recognizer-worker.js',{type:'module'});
   try{return await new Promise((resolve,reject)=>{
    worker.onerror=e=>reject(Error(e.message));
    worker.onmessage=({data})=>{if(data.type==='progress')void window.reportProgress(data.batchSize);if(data.type==='error')reject(Error(data.message));if(data.type==='result')resolve(data);};
    worker.postMessage({image,boxes,captureOnly});
   });}finally{worker.terminate();}
  },{boxes,captureOnly});
  if(captureOnly){await fs.writeFile(path.join(root,'ocr-runs/gpu-capture-check.json'),JSON.stringify(output.capture,null,2));console.log(JSON.stringify(output.capture));return;}
  const reports=output.reports;
  const baseline=reports[0].runs.at(-1).texts;
  const summary=reports.map(r=>({batchSize:r.batchSize,bucket:r.bucket,gpuInput:r.gpuInput,calls:r.calls,warmMs:(r.runs[1].elapsedMs+r.runs[2].elapsedMs)/2,textDifferences:r.runs.at(-1).texts.flatMap((t,i)=>t.text===baseline[i].text?[]:[{line:i,original:baseline[i].text,batched:t.text}])}));
  await fs.writeFile(path.join(root,'ocr-runs/gpu-batch-check.json'),JSON.stringify({boxes,reports,summary},null,2));
  console.log(JSON.stringify(summary));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
