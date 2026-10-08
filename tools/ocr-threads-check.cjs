const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/threads-fixture.jpg',r=>r.fulfill({path:path.resolve(__dirname,'../../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');
  const results=await page.evaluate(async()=>{
   if(!crossOriginIsolated)throw Error('Missing cross-origin isolation');
   const image=await(await fetch('./threads-fixture.jpg')).blob(),results=[];
   for(const threads of [1,2,4]){
    const worker=new Worker(`./worker.js?threads=${threads}`,{type:'module'});
    const run=()=>new Promise((resolve,reject)=>{
     worker.onerror=e=>reject(Error(e.message));
     worker.onmessage=({data})=>{if(data.type==='error')reject(Error(data.message));if(data.type==='result')resolve(data.result);};
     worker.postMessage({image,mode:'wasm'});
    });
    try{for(let i=0;i<3;i++)results.push(await run());}finally{worker.terminate();}
   }
   return results;
  });
  await fs.writeFile(path.resolve(__dirname,'../ocr-runs/threads-check.json'),JSON.stringify(results,null,2));
  const geometryAndText=segments=>JSON.parse(JSON.stringify(segments,(key,value)=>key==='confidence'?undefined:value));
  let maxConfidenceDifference=0;
  for(const r of results){
   assert.deepEqual(geometryAndText(r.segments),geometryAndText(results[0].segments));
   r.segments.forEach((s,i)=>s.lines.forEach((line,j)=>{
    maxConfidenceDifference=Math.max(maxConfidenceDifference,Math.abs(line.confidence-results[0].segments[i].lines[j].confidence));
   }));
  }
  assert.ok(maxConfidenceDifference<1e-5);
  assert.deepEqual(results.map(r=>r.threads),[1,1,1,2,2,2,4,4,4]);
  await fs.writeFile(path.resolve(__dirname,'../ocr-runs/threads-check.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({identicalTextAndBoxes:true,maxConfidenceDifference,runs:results.map(r=>({threads:r.threads,reused:r.reusedSessions,elapsedMs:r.elapsedMs,initializationMs:r.initializationMs}))}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
