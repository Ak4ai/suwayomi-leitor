// Real browser OCR, free translation and lettering on two representative pages.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  const report=await page.evaluate(async()=>{
   const {chapterPages}=await import('./suwayomi.js'),{ChapterEngine}=await import('./chapter-engine.js'),{Lettering,ReadableLettering,loadLetteringFonts}=await import('./lettering.js'),pages=await chapterPages('http://127.0.0.1:4567',62),engine=new ChapterEngine(),rows=[];await loadLetteringFonts();
   try{
    for(const index of [4,6,10,20,29]){
     const response=await fetch(pages[index].url,{credentials:'include'}),blob=await response.blob(),result=await engine.process({},blob,{mode:'wasm',threads:4,provider:'google',scope:'all',filterNoise:true},AbortSignal.timeout(90000),()=>{}),image=await createImageBitmap(blob),canvas=document.createElement('canvas'),lettering=new Lettering();
     const paint=lettering.paint(canvas,image,result.segments,{translated:true,fontReady:true}),readable=new ReadableLettering(),scaledCanvas=document.createElement('canvas'),scaled=readable.paint(scaledCanvas,image,result.segments,{translated:true,fontReady:true});rows.push({page:index+1,totalMs:result.totalMs,segments:result.segments,ignored:result.ignoredSegments,applied:paint.applied,notes:[...paint.notes],readableApplied:scaled.applied,readableNotes:[...scaled.notes],render:canvas.toDataURL('image/png'),readableRender:scaledCanvas.toDataURL('image/png')});image.close();
    }
   }finally{engine.stop();}
   return rows;
  });
  const directory=path.join(root,'ocr-runs/bbato-batman-1');
  for(const row of report){await fs.writeFile(path.join(directory,`translated-${String(row.page).padStart(3,'0')}.png`),Buffer.from(row.render.split(',')[1],'base64'));await fs.writeFile(path.join(directory,`readable-${String(row.page).padStart(3,'0')}.png`),Buffer.from(row.readableRender.split(',')[1],'base64'));delete row.render;delete row.readableRender;}
  await fs.writeFile(path.join(directory,'translation-render-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(r=>({page:r.page,totalMs:r.totalMs,segments:r.segments.length,applied:r.applied,readableApplied:r.readableApplied,readableNotes:r.readableNotes}))));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


