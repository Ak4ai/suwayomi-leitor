const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),fixture=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/web-local-7.json'),'utf8')),browser=await chromium.launch({channel:'msedge',headless:true});
 let calls=0,modelsCalls=0,fail=true;const errors=[];
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/worker\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'},body:`self.onmessage=()=>{self.postMessage({type:'progress',message:'MOCK OCR RUN'});setTimeout(()=>self.postMessage({type:'result',result:${JSON.stringify(fixture)}}),300);};`}));
  await page.route('https://generativelanguage.googleapis.com/v1beta/models?**',r=>{modelsCalls++;return r.fulfill({contentType:'application/json',body:JSON.stringify({models:[{name:'models/gemini-2.5-flash',displayName:'Flash',supportedGenerationMethods:['generateContent']}]})});});
  await page.route('https://generativelanguage.googleapis.com/v1beta/models/*:generateContent',r=>{
   calls++;if(fail)return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Temporary server failure'}})});
   const items=JSON.parse(r.request().postDataJSON().contents[0].parts[0].text);
   return r.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({segments:items.map(item=>({id:item.id,translation:'Tradução de teste'}))})}]}}]})});
  });
  await page.goto('http://127.0.0.1:3003/chapter.html');
  await page.evaluate(async()=>{const {ChapterCache}=await import('./chapter-engine.js');await new ChapterCache().clear();});
  await page.locator('#provider').selectOption('gemini');await page.locator('#key').fill('test-key-only');await page.locator('#models').click();await page.waitForFunction(()=>document.querySelector('#model').value==='gemini-2.5-flash');
  await page.locator('#files').setInputFiles(path.resolve(root,'../imagensinputteste/7.jpg'));await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('Na fila'));
  await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#retry').disabled===false&&document.querySelector('#queue-status').textContent.includes('503'));
  assert.equal(calls,3);fail=false;
  await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('1/1'));assert.equal(calls,4);
  await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('1/1'));assert.equal(calls,5);
  await page.locator('#redo-ocr').click();await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.includes('MOCK OCR RUN'));await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('1/1'));assert.equal(calls,6);
  await page.reload();assert.equal(await page.locator('#key').inputValue(),'test-key-only');assert.equal(await page.locator('#model').inputValue(),'gemini-2.5-flash');assert.equal(await page.locator('#provider').inputValue(),'gemini');assert.equal(modelsCalls,1);
  await page.locator('#forget-key').click();await page.reload();assert.equal(await page.locator('#key').inputValue(),'');assert.equal(await page.locator('#remember-key').isChecked(),false);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,transientAttempts:3,manualRetry:true,forceTranslation:true,forceOCR:true,preferencesRestored:true,keyForgotten:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
