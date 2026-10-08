const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const result=await page.evaluate(async()=>{
   const {chapterPages}=await import('./suwayomi.js');
   const pages=await chapterPages('https://suwayomi-server-ak4ai.fly.dev/manga/5/chapter/134',134);
   const response=await fetch(pages[0].url,{credentials:'include'}),blob=await response.blob();
   return {pages:pages.length,firstImageStatus:response.status,firstImageBytes:blob.size,isolated:crossOriginIsolated};
  });
  assert.equal(result.pages,31);assert.equal(result.firstImageStatus,200);assert.ok(result.firstImageBytes>1000);
  await page.locator('#open-link').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('1 / 31'));
  await page.waitForFunction(()=>document.querySelector('#page').width>300);
  await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('2 / 31'));await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('Na fila'));
  await page.screenshot({path:path.join(root,'ocr-runs/chapter-interface.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});const noMobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert.equal(noMobileOverflow,true);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({...result,noMobileOverflow,navigationWorks:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
