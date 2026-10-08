const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  const cases=JSON.parse(await fs.readFile('ocr-runs/bbato-batman-1/translation-render-check.json','utf8')),rows=[];
  for(const row of cases){
   const data=(await fs.readFile(`ocr-runs/bbato-batman-1/${String(row.page).padStart(3,'0')}.jpg`)).toString('base64');
   const result=await page.evaluate(async({data,segments})=>{
    const {ReadableLettering,loadLetteringFonts}=await import('./lettering.js');await loadLetteringFonts();
    const image=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+data)).blob());
    try{const canvas=document.createElement('canvas'),paint=new ReadableLettering().paint(canvas,image,segments,{translated:true,fontReady:true});return{applied:paint.applied,notes:[...paint.notes],quality:[...paint.cleanupQuality],png:canvas.toDataURL()};}finally{image.close();}
   },{data,segments:row.segments});
   await fs.writeFile(`ocr-runs/bbato-batman-1/local-clean-${String(row.page).padStart(3,'0')}.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png;rows.push({page:row.page,...result});
  }
  await fs.writeFile('ocr-runs/bbato-batman-1/local-inpaint-check.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(row=>({page:row.page,applied:row.applied,recovered:row.quality.reduce((sum,[,q])=>sum+q.recoveredPixels,0),panel:row.notes.filter(([,note])=>note.includes('painel'))}))));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
