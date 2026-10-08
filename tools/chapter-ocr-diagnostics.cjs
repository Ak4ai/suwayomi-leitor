// Diagnostic OCR on a chosen local Suwayomi chapter. No translation calls.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const chapterId=Number(process.argv[2]),label=process.argv[3];if(!Number.isSafeInteger(chapterId)||!label||!/^[a-z0-9-]+$/.test(label))throw Error('Usage: node tools/chapter-ocr-diagnostics.cjs CHAPTER_ID LABEL');
 const root=path.resolve(__dirname,'..'),directory=path.join(root,'ocr-runs',label),rows=[],browser=await chromium.launch({channel:'msedge',headless:true});await fs.mkdir(directory,{recursive:true});
 try{
  const page=await browser.newPage();await page.goto(process.argv[4]||'http://127.0.0.1:3003/chapter.html');
  await page.exposeFunction('saveDiagnosticImage',async(index,base64)=>fs.writeFile(path.join(directory,`${String(index).padStart(3,'0')}.jpg`),Buffer.from(base64,'base64')));
  await page.exposeFunction('saveDiagnosticPage',async row=>{rows.push(row);await fs.writeFile(path.join(directory,`${String(row.page).padStart(3,'0')}.json`),JSON.stringify(row,null,2));console.log(JSON.stringify({page:row.page,size:[row.result.width,row.result.height],raw:row.result.segments.length,selected:row.filtered.segments.length,balloons:row.result.detections.bubbles.length,ocrMs:row.result.elapsedMs}));});
  await page.evaluate(async chapterId=>{
   const {chapterPages}=await import('./suwayomi.js'),{selectSegments}=await import('./ocr-quality.js'),{imageQuality}=await import('./image-quality.js'),pages=await chapterPages('http://127.0.0.1:4567',chapterId),worker=new Worker('./worker.js?threads=4',{type:'module'});
   try{
    for(let i=0;i<pages.length;i++){
     const response=await fetch(pages[i].url,{credentials:'include'});if(!response.ok)throw Error('Image HTTP '+response.status);const image=await response.blob();
     const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(image);});await window.saveDiagnosticImage(i+1,encoded);
     const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('OCR timeout')),90000);worker.onerror=e=>{clearTimeout(timeout);reject(Error(e.message));};worker.onmessage=({data})=>{if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}if(data.type==='result'){clearTimeout(timeout);resolve(data.result);}};worker.postMessage({image,mode:'wasm',lineMerge:false,targetedPadding:false});});
     await window.saveDiagnosticPage({page:i+1,result,filtered:selectSegments(result.segments,'all',true),balloonsOnly:selectSegments(result.segments,'balloons',true),imageQuality:imageQuality(result.width,result.height)});
    }
   }finally{worker.terminate();}
  },chapterId);
  const summary={chapterId,pages:rows.length,totalOcrMs:rows.reduce((sum,r)=>sum+r.result.elapsedMs,0),raw:rows.reduce((sum,r)=>sum+r.result.segments.length,0),selected:rows.reduce((sum,r)=>sum+r.filtered.segments.length,0),small:rows.filter(r=>r.imageQuality.small).map(r=>r.page),empty:rows.filter(r=>!r.filtered.segments.length).map(r=>r.page)};
  await fs.writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
