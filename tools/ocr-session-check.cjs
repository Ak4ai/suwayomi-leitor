// Real local OCR: cold/warm sessions and mode changes, without translation APIs.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/session-fixture.jpg',r=>r.fulfill({path:path.resolve(__dirname,'../../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');
  const results=await page.evaluate(async()=>{
   const image=await(await fetch('./session-fixture.jpg')).blob();
   const worker=new Worker('./worker.js',{type:'module'});
   const run=mode=>new Promise((resolve,reject)=>{
    worker.onerror=e=>reject(Error(e.message));
    worker.onmessage=({data})=>{if(data.type==='error')reject(Error(data.message));if(data.type==='result')resolve(data.result);};
    worker.postMessage({image,mode});
   });
   try{return [await run('wasm'),await run('wasm'),await run('auto'),await run('wasm')];}
   finally{worker.terminate();}
  });
  assert.equal(results[0].reusedSessions,false);
  assert.equal(results[1].reusedSessions,true);
  assert.equal(results[2].reusedSessions,false);
  assert.equal(results[3].reusedSessions,false);
  assert.deepEqual(results[0].segments,results[1].segments);
  assert.deepEqual(results[0].segments,results[3].segments);
  await fs.mkdir(path.resolve(__dirname,'../ocr-runs'),{recursive:true});
  await fs.writeFile(path.resolve(__dirname,'../ocr-runs/session-check.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({sameWasmOutput:true,runs:results.map(r=>({elapsedMs:r.elapsedMs,initializationMs:r.initializationMs,reused:r.reusedSessions,segments:r.segments.length}))}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
