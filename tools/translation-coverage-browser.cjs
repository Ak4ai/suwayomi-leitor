const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let calls=0;
 try{
  const page=await browser.newPage();
  await page.route('https://mymemory.translated.net/api/get?**',r=>{
   calls++;const q=new URL(r.request().url()).searchParams.get('q'),partial=q.includes('FIX THE WORLD');
   return r.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{translatedText:partial?'Não sei como.':'Olá',match:partial?.44:1},matches:[{segment:partial?"I don't know how to.":q,translation:partial?'Não sei como.':'Olá',match:partial?.44:1}]})});
  });
  await page.goto('http://127.0.0.1:3003/chapter.html');
  const report=await page.evaluate(async()=>{
   const {translateMyMemory,translateGoogle}=await import('./translation.js'),source="I DON'T KNOW. I'M...JUST ONE PERSON. I DON'T KNOW HOW TO FIX THE WORLD.",completed=[],failed=[];
   let rejected=false;
   try{await translateMyMemory([{id:'bad',sourceText:source},{id:'good',sourceText:'Hello'}],new AbortController().signal,()=>{},(id,value)=>completed.push({id,value}),(id,error)=>failed.push({id,message:error.message,candidate:error.candidate}));}catch(e){rejected=e.segmentErrors?.has('bad');}
   const google=await translateGoogle([{id:'full',sourceText:source}],AbortSignal.timeout(25000));
   return {rejected,completed,failed,google:google.get('full')};
  });
  assert.equal(calls,2);assert.equal(report.rejected,true);assert.deepEqual(report.completed,[{id:'good',value:'Olá'}]);assert.equal(report.failed.length,1);assert.ok(report.google.toLowerCase().includes('pessoa'));assert.ok(report.google.toLowerCase().includes('mundo'));
  console.log(JSON.stringify({passed:true,otherBalloonContinues:true,rejectedPartial:report.failed[0].candidate,liveGoogleTranslation:report.google}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
