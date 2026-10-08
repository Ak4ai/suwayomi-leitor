// UI regression with saved OCR/translations. No external translation calls.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),fixture=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/web-local-7.json'),'utf8')),translations=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/gemini-live-7.json'),'utf8'));
 const {selectSegments}=await import('../public/ocr-web/ocr-quality.js'),expectedCount=selectSegments(fixture.segments).segments.length;
 const texts=new Map(fixture.segments.map(s=>[s.sourceText.replace(/\s+/g,' ').trim(),translations.rows.find(r=>r.id===s.id)?.translation||'Tradução de teste']));
 const browser=await chromium.launch({channel:'msedge',headless:true});let workers=0,requests=0;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/\/worker\.js(?:\?.*)?$/,r=>{workers++;return r.fulfill({contentType:'text/javascript',headers:{'Cross-Origin-Embedder-Policy':'require-corp'},body:`self.onmessage=()=>setTimeout(()=>self.postMessage({type:'result',result:${JSON.stringify(fixture)}}),200);`});});
  await page.route('https://mymemory.translated.net/api/get?**',r=>{requests++;return r.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{match:1,translatedText:texts.get(new URL(r.request().url()).searchParams.get('q'))||'Tradução de teste'}})});});
  await page.goto('http://127.0.0.1:3003/chapter.html');
  await page.evaluate(async()=>{const {ChapterCache}=await import('./chapter-engine.js');await new ChapterCache().clear();});
  const image=await fs.readFile(path.resolve(root,'../imagensinputteste/7.jpg'));
  await page.locator('#files').setInputFiles([{name:'10.jpg',mimeType:'image/jpeg',buffer:image},{name:'9.jpg',mimeType:'image/jpeg',buffer:image}]);
  await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('Na fila'));
  assert.ok((await page.locator('#page-number').innerText()).endsWith('9.jpg'));
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('2/2'),{timeout:30000});
  assert.equal(workers,1);assert.equal(requests,expectedCount);
  const translated=await page.locator('#page').evaluate(c=>c.toDataURL());await page.locator('#overlay').uncheck();const original=await page.locator('#page').evaluate(c=>c.toDataURL());assert.notEqual(translated,original);
  await page.locator('#overlay').check();assert.equal(await page.locator('#page').evaluate(c=>c.toDataURL()),translated);
  await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('cache'));
  await page.locator('#pause').click();assert.equal(await page.locator('#mode').isDisabled(),false);
  await page.screenshot({path:path.join(root,'ocr-runs/chapter-translated-interface.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});const noMobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.equal(noMobileOverflow,true);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,naturalOrder:true,workers,translationRequests:requests,secondPageCached:true,overlayToggle:true,noMobileOverflow,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
