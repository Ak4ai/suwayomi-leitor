// Mock only OCR and translation; IndexedDB and the queue engine are real.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),fixture=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/web-local-7.json'),'utf8')),browser=await chromium.launch({channel:'msedge',headless:true});
 let workers=0,calls=0,quota=false,quotaCalls=0;
 try{
  const page=await browser.newPage();
  await page.route(/\/worker\.js(?:\?.*)?$/,route=>{workers++;return route.fulfill({contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'},body:`self.onmessage=async({data})=>{const result=${JSON.stringify(fixture)};if(data.image.size<100)for(const s of result.segments)s.sourceText='QUOTA '+s.sourceText;self.postMessage({type:'result',result});};`});});
  await page.route('https://mymemory.translated.net/api/get?**',route=>{
   calls++;const text=new URL(route.request().url()).searchParams.get('q');if(text.startsWith('QUOTA '))quotaCalls++;
   const failure=quota&&quotaCalls===4;
   return route.fulfill({contentType:'application/json',body:JSON.stringify(failure?{responseStatus:429,quotaFinished:true}:{responseStatus:200,responseData:{match:1,translatedText:`Texto traduzido: ${text}`}})});
  });
  await page.route('**/cache-fixture.jpg',r=>r.fulfill({path:path.resolve(root,'../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const first=await page.evaluate(async()=>{
   const {ChapterEngine}=await import('./chapter-engine.js');window.cacheEngine=new ChapterEngine();await window.cacheEngine.cache.clear();window.cacheSettings={mode:'wasm',threads:4,provider:'mymemory',key:'',model:''};window.cacheImage=await(await fetch('./cache-fixture.jpg')).blob();
   const first=await window.cacheEngine.process({},window.cacheImage,window.cacheSettings,new AbortController().signal,()=>{}),second=await window.cacheEngine.process({},window.cacheImage,window.cacheSettings,new AbortController().signal,()=>{});window.cacheEngine.stop();
   return {firstCached:first.cacheHit,secondCached:second.cacheHit,segments:first.segments.length};
  });
  const callsAfterFirst=calls;assert.equal(workers,1);assert.equal(first.firstCached,false);assert.equal(first.secondCached,true);
  await page.reload();
  const persisted=await page.evaluate(async()=>{const {ChapterEngine}=await import('./chapter-engine.js');window.cacheEngine=new ChapterEngine();window.cacheSettings={mode:'wasm',threads:4,provider:'mymemory',key:'',model:''};const blob=await(await fetch('./cache-fixture.jpg')).blob();return(await window.cacheEngine.process({},blob,window.cacheSettings,new AbortController().signal,()=>{})).cacheHit;});
  assert.equal(persisted,true);assert.equal(calls,callsAfterFirst);assert.equal(workers,1);
  quota=true;
  const failed=await page.evaluate(async()=>{try{await window.cacheEngine.process({},new Blob(['quota fixture']),window.cacheSettings,new AbortController().signal,()=>{});return false;}catch(e){return e.pauseQueue;}});
  assert.equal(failed,true);assert.equal(quotaCalls,4);quota=false;
  const recovered=await page.evaluate(async()=>{const result=await window.cacheEngine.process({},new Blob(['quota fixture']),window.cacheSettings,new AbortController().signal,()=>{});window.cacheEngine.stop();return result.segments.every(s=>s.translation);});
  assert.equal(recovered,true);assert.equal(workers,2);assert.equal(quotaCalls,fixture.segments.length+1);
  console.log(JSON.stringify({passed:true,persistentCache: persisted,quotaRecovery:recovered,workers,calls,quotaCalls}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
