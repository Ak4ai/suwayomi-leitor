const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),requests=[];page.on('request',r=>{if(r.url().includes('mymemory'))requests.push(new URL(r.url()).origin);});
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const translated=await page.evaluate(async()=>{const {translateMyMemory}=await import('./translation.js');const result=await translateMyMemory([{id:'test',sourceText:'Hello, how are you?',translation:''}],AbortSignal.timeout(20000));return result.get('test');});
  assert.ok(translated?.trim());assert.notEqual(translated,'Hello, how are you?');assert.ok(requests.includes('https://mymemory.translated.net'));
  console.log(JSON.stringify({passed:true,translation:translated,endpoints:requests}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
