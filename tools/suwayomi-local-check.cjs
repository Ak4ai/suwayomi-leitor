// Real local server, real reader OCR and translation; no Fly.io requests.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const api=await page.evaluate(async()=>{
   const {library,chapters,chapterPages}=await import('./suwayomi.js'),server='http://127.0.0.1:4567',mangas=await library(server),rows=await chapters(server,2),pages=await chapterPages(server,rows[0].id),response=await fetch(pages[0].url,{credentials:'include'});
   return {library:mangas,chapters:rows,pages:pages.length,imageStatus:response.status,imageBytes:(await response.blob()).size};
  });
  assert.equal(api.library.length,2);assert.equal(api.pages,9);assert.equal(api.imageStatus,200);
  await page.locator('#open-link').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('1 / 1'));
  await page.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('Na fila'));
  await page.locator('#provider').selectOption('google');await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#queue-status').textContent.startsWith('1/1'),{timeout:120000});
  const completed=await page.locator('#image-status').innerText(),translations=await page.locator('#dialogue article p').allTextContents();
  assert.ok(translations.length>5);assert.ok(translations.every(t=>t.trim()&&!t.includes('Aguardando')));
  await page.screenshot({path:path.join(root,'ocr-runs/local-chapter-reader.png'),fullPage:true});
  await page.locator('#pause').click();
  await page.locator('#chapter-link').fill('http://127.0.0.1:4567/manga/2/chapter/2');await page.locator('#open-link').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('1 / 9'));
  await page.locator('#next').click();await page.waitForFunction(()=>document.querySelector('#page-number').textContent.startsWith('2 / 9'));
  assert.deepEqual(errors,[]);
  const report={passed:true,api,completed,translations,navigationWorks:true,errors};await fs.writeFile(path.join(root,'ocr-runs/suwayomi-local-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,translations:translations.length}));
  await page.goto('http://127.0.0.1:4567/library');await page.waitForFunction(()=>document.body.textContent.includes('Amostra IHC'),{timeout:30000});await page.screenshot({path:path.join(root,'ocr-runs/local-suwayomi-library.png'),fullPage:true});console.log('Native WebUI library verified');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
