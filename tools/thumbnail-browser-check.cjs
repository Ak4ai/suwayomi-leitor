const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let translations=0;
 try{
  const page=await browser.newPage();await page.route(/\/worker\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'},body:`self.onmessage=()=>self.postMessage({type:'result',result:{width:280,height:431,segments:[{id:'s1',box:[0,0,100,40],bubble:[0,0,110,50],sourceText:'Hello',translation:'',lines:[{text:'Hello',box:[0,0,100,40],confidence:.99}]}]}});`}));
  await page.route('https://translate.googleapis.com/**',r=>{translations++;return r.fulfill({contentType:'application/json',body:JSON.stringify([[['Olá','Hello']]])});});
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const result=await page.evaluate(async()=>{
   const {ChapterEngine}=await import('./chapter-engine.js'),engine=new ChapterEngine(),settings={mode:'wasm',threads:4,provider:'google',scope:'all',filterNoise:true};await engine.cache.clear();
   let rejected=false;try{await engine.process({},new Blob(['thumbnail-test']),settings,new AbortController().signal,()=>{});}catch(e){rejected=e.code==='LOW_IMAGE_RESOLUTION'&&e.pauseQueue;}
   const allowed=await engine.process({},new Blob(['thumbnail-test']),{...settings,allowSmallImages:true},new AbortController().signal,()=>{});engine.stop();return {rejected,allowed:allowed.segments[0].translation};
  });
  assert.equal(result.rejected,true);assert.equal(result.allowed,'Olá');assert.equal(translations,1);console.log(JSON.stringify({passed:true,blocksBeforeTranslation:true,explicitOverrideWorks:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
