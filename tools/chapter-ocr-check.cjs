const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  await page.exposeFunction('ocrProgress',data=>console.log(JSON.stringify(data)));
  const report=await page.evaluate(async()=>{
   const {chapterPages}=await import('./suwayomi.js'),pages=await chapterPages('https://suwayomi-server-ak4ai.fly.dev',134),runs=[];
   for(const mode of ['wasm','auto']){
    const worker=new Worker('./worker.js?threads=4',{type:'module'});
    try{
     for(const [index,entry] of pages.entries()){
      const started=performance.now(),response=await fetch(entry.url,{credentials:'include'});if(!response.ok)throw Error('Image HTTP '+response.status);const image=await response.blob();
      const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('OCR timeout')),60000);worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.result);}};worker.postMessage({image,mode});});
      runs.push({mode,page:index+1,downloadAndOcrMs:performance.now()-started,...result});
      await window.ocrProgress({mode,page:index+1,ocrMs:result.elapsedMs,texts:result.segments.filter(s=>s.sourceText.trim()).length});
     }
    }finally{worker.terminate();}
   }
   return {pages:pages.length,runs};
  });
  report.summary=['wasm','auto'].map(mode=>{const rows=report.runs.filter(r=>r.mode===mode),sorted=rows.slice(1).map(r=>r.elapsedMs).toSorted((a,b)=>a-b);return{mode,pages:rows.length,totalOcrMs:rows.reduce((sum,r)=>sum+r.elapsedMs,0),warmMedianMs:(sorted[14]+sorted[15])/2,pagesWithText:rows.filter(r=>r.segments.some(s=>s.sourceText.trim())).map(r=>({page:r.page,text:r.segments.map(s=>s.sourceText).filter(Boolean).join('\n')}))};});
  await fs.writeFile(path.resolve(__dirname,'../ocr-runs/chapter-ocr-134.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.summary));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
