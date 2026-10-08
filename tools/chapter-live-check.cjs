// Real OCR and free translation on a small window of the specified chapter.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  await page.exposeFunction('chapterProgress',data=>console.log(JSON.stringify(data)));
  const report=await page.evaluate(async()=>{
   const {ChapterEngine}=await import('./chapter-engine.js'),{ChapterQueue}=await import('./chapter-queue.js'),{chapterPages}=await import('./suwayomi.js'),engine=new ChapterEngine();
   const pages=(await chapterPages('https://suwayomi-server-ak4ai.fly.dev',134)).slice(0,2),settings={mode:'wasm',threads:4,provider:'mymemory',model:'',key:''},runs=[],started=performance.now();
   let resolveDone;const done=new Promise(resolve=>resolveDone=resolve);
   const queue=new ChapterQueue(async(job,signal,update)=>{
    const response=await fetch(job.url,{signal,credentials:'include'});if(!response.ok)throw Error('Image HTTP '+response.status);
    const result=await engine.process(job,await response.blob(),settings,signal,update);
    runs.push({page:job.name,totalMs:result.totalMs,ocrMs:result.elapsedMs,initializationMs:result.initializationMs,reusedSessions:result.reusedSessions,cacheHit:result.cacheHit,segments:result.segments});
    return result;
   },queue=>{
    const active=queue.jobs.find(j=>['loading','ocr','translating'].includes(j.status));
    if(active&&active.message!==active.lastMessage){active.lastMessage=active.message;void window.chapterProgress({page:active.name,status:active.status,message:active.message});}
    if(queue.jobs.length&&(queue.jobs.every(j=>['ready','failed'].includes(j.status))||queue.paused&&queue.jobs.some(j=>j.status==='failed')))resolveDone();
   });
   queue.setPages(pages);queue.setAhead(Infinity);queue.start();
   const timeout=setTimeout(()=>{queue.pause();resolveDone();},180000);
   try{await done;return {elapsedMs:performance.now()-started,runs,jobs:queue.jobs.map(j=>({page:j.name,status:j.status,error:j.error})),paused:queue.paused};}
   finally{clearTimeout(timeout);queue.pause();engine.stop();}
  });
  await fs.writeFile(path.join(root,'ocr-runs/chapter-live-134.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({elapsedMs:report.elapsedMs,runs:report.runs.map(r=>({...r,segments:r.segments.length})),jobs:report.jobs,paused:report.paused}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
