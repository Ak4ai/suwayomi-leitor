// Real chapter OCR, with per-page raw detections and filtering diagnostics.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),label=process.argv[2]||'baseline';if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid label');
 const chapterId=Number(process.argv[4])||58,limit=Number(process.argv[3])||(chapterId===61?179:44),browser=await chromium.launch({channel:'msedge',headless:true}),rows=[];
 const dir=path.join(root,chapterId===61?'ocr-runs/absolute-batman-volume-1':'ocr-runs/absolute-batman-1');await fs.mkdir(dir,{recursive:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  await page.exposeFunction('saveBatmanPage',async row=>{rows.push(row);await fs.writeFile(path.join(dir,`${label}-${String(row.page).padStart(3,'0')}.json`),JSON.stringify(row,null,2));console.log(JSON.stringify({page:row.page,raw:row.result.segments.length,selected:row.filtered.segments.length,ignored:row.filtered.ignoredSegments.map(s=>({text:s.sourceText,reason:s.reason})),ocrMs:row.result.elapsedMs}));});
  await page.exposeFunction('saveBatmanImage',async(i,bytes)=>{const file=path.join(dir,`${String(i).padStart(3,'0')}.jpg`);if(!await fs.stat(file).catch(()=>null))await fs.writeFile(file,Buffer.from(bytes));});
  await page.evaluate(async({limit,lineClip,chapterId})=>{
   const {chapterPages}=await import('./suwayomi.js'),{selectSegments}=await import('./ocr-quality.js'),pages=await chapterPages('http://127.0.0.1:4567',chapterId),worker=new Worker('./worker.js?threads=4',{type:'module'});
   try{
    for(let i=0;i<Math.min(limit,pages.length);i++){
     const response=await fetch(pages[i].url,{credentials:'include'});if(!response.ok)throw Error('Image HTTP '+response.status);const image=await response.blob();await window.saveBatmanImage(i+1,[...new Uint8Array(await image.arrayBuffer())]);
     const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('OCR timeout')),90000);worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.result);}};worker.postMessage({image,mode:'wasm',lineClip});});
     await window.saveBatmanPage({page:i+1,result,filtered:selectSegments(result.segments,'all',true),balloonsOnly:selectSegments(result.segments,'balloons',true)});
    }
   }finally{worker.terminate();}
  },{limit,lineClip:label.includes('lineclip'),chapterId});
  await fs.writeFile(path.join(dir,`${label}-summary.json`),JSON.stringify({label,chapterId,pages:rows.length,totalOcrMs:rows.reduce((sum,r)=>sum+r.result.elapsedMs,0),raw:rows.reduce((sum,r)=>sum+r.result.segments.length,0),selected:rows.reduce((sum,r)=>sum+r.filtered.segments.length,0)},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
