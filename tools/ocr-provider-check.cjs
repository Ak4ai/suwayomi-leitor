// End-to-end provider comparison; no translation APIs, same source image.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/provider-fixture.jpg',r=>r.fulfill({path:path.resolve(__dirname,'../../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');
  await page.exposeFunction('providerProgress',(mode,i)=>console.log(`${mode}: ${i+1}/5`));
  const report=await page.evaluate(async()=>{
   const adapter=await navigator.gpu?.requestAdapter();
   const environment={userAgent:navigator.userAgent,isolated:crossOriginIsolated,gpuAvailable:!!adapter,gpu:adapter?.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null};
   const image=await(await fetch('./provider-fixture.jpg')).blob(),runs=[];
   for(const [mode,threads] of [['wasm',4],['lines-gpu',4],['recognizer-gpu',4],['auto',4]]){
    const worker=new Worker(`./worker.js?threads=${threads}`,{type:'module'});
    try{
     for(let i=0;i<5;i++){
      const result=await new Promise((resolve,reject)=>{
       const timeout=setTimeout(()=>reject(Error('OCR timed out')),120000);
       worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};
       worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.result);}};
       worker.postMessage({image,mode});
      });
      runs.push({mode,iteration:i,...result});
      await window.providerProgress(mode,i);
     }
    }finally{worker.terminate();}
   }
   return {environment,runs};
  });
  const groups=[];
  for(const key of ['wasm-4','lines-gpu-4','recognizer-gpu-4','auto-4']){
   const rows=report.runs.filter(r=>`${r.mode}-${r.threads}`===key),warm=rows.slice(1);
   const avg=fn=>warm.reduce((sum,r)=>sum+fn(r),0)/warm.length;
   groups.push({key,coldMs:rows[0].elapsedMs,warmMs:avg(r=>r.elapsedMs),inferenceMs:Object.fromEntries(['detector','lines','recognizer'].map(role=>[role,avg(r=>r.metrics.inferenceMs[role])])),otherMs:avg(r=>r.metrics.otherMs),calls:warm.map(r=>r.metrics.calls),regions:warm.map(r=>r.segments.length),providers:rows.at(-1).providers,fallbacks:rows.at(-1).fallbacks,stableText:warm.every(r=>JSON.stringify(r.segments.map(s=>s.sourceText))===JSON.stringify(warm[0].segments.map(s=>s.sourceText)))});
  }
  report.summary=groups;
  await fs.writeFile(path.resolve(__dirname,'../ocr-runs/provider-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({environment:report.environment,summary:groups}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
