const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});let apiTranslations=0;
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('translate.googleapis.com')||r.url().includes('mymemory'))apiTranslations++;});
  await page.goto('http://127.0.0.1:3003/chapter.html');await page.locator('#chapter-link').fill('http://127.0.0.1:4567/manga/33/chapter/61');await page.locator('#open-link').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('1 / 179'));
  await page.locator('#queue button').nth(10).click();await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('280×431'));
  await page.locator('#provider').selectOption('google');await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.includes('muito pequena'),{timeout:30000});
  assert.equal(apiTranslations,0);assert.equal(await page.locator('#pause').isDisabled(),true);assert.ok((await page.locator('#image-status').innerText()).includes('280×431'));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(root,'ocr-runs/absolute-batman-volume-1/low-resolution-warning.png'),fullPage:true});
  console.log(JSON.stringify({passed:true,pages:179,thumbnailWarning:true,queuePaused:true,translationCalls:apiTranslations,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
