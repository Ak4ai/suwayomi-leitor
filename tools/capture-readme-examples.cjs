const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const out='docs/examples';await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1100,height:950}});await page.goto('http://127.0.0.1:3010/chapter.html');
 const provenance=[];
 async function capture(name,bytes,mime,clip,source){
  const [x,y,w,h]=clip,scale=Math.min(1,760/w,850/h);
  await page.evaluate(async({data,mime,x,y,w,h,scale})=>{
   document.body.innerHTML='';document.body.style.cssText='margin:0;background:white';
   const frame=document.createElement('div');frame.id='capture';frame.style.cssText=`position:relative;width:${Math.ceil(w*scale)}px;height:${Math.ceil(h*scale)}px;overflow:hidden;background:white`;
   const img=document.createElement('img');img.style.cssText=`position:absolute;left:${-x*scale}px;top:${-y*scale}px;transform:scale(${scale});transform-origin:top left;max-width:none;max-height:none;`;img.src=`data:${mime};base64,${data}`;frame.append(img);document.body.append(frame);await img.decode();
  },{data:bytes.toString('base64'),mime,x,y,w,h,scale});
  await page.locator('#capture').screenshot({path:path.join(out,name+'.png')});provenance.push({image:name+'.png',source,clip});
 }
 const root='ocr-runs/sorcerer-supreme-1/',clip=[465,1910,500,650];
 for(const [name,file,mime] of [['original','020.jpg','image/jpeg'],['leve-canvas','svg-raster.png','image/png'],['leve-svg','page20-translated.svg','image/svg+xml'],['ia-svg','ai-wasm-all.svg','image/svg+xml'],['hibrido-svg','ai-wasm-hybrid.svg','image/svg+xml']])await capture(name,await fs.readFile(root+file),mime,clip,root+file);
 async function render(name,imagePath,segments,clip,source){
  const bytes=await fs.readFile(imagePath);
  const svg=await page.evaluate(async({data,segments})=>{
   const {renderLetteringSVG}=await import('./lettering-svg.js'),{loadLetteringFonts}=await import('./lettering.js');await loadLetteringFonts();
   const image=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+data)).blob());
   try{return(await renderLetteringSVG(image,segments)).svg;}finally{image.close();}
  },{data:bytes.toString('base64'),segments});
  await capture(name,Buffer.from(svg),'image/svg+xml',clip,source);
 }
 const raw=JSON.parse(await fs.readFile(root+'020.json','utf8'));
 for(const [name,file] of [['opus-compacto','opus-sentence-check.json'],['opus-maior','opus-big-sentence-check.json']]){
  const report=JSON.parse(await fs.readFile(root+file,'utf8')),translations=new Map(report.warm.rows.map(r=>[r.id,r.translation]));
  await render(name,root+'020.jpg',raw.filtered.segments.map(s=>({...s,translation:translations.get(s.id)||''})),clip,root+file+' (saved translation, current light SVG renderer)');
 }
 const googleRoot='ocr-runs/bbato-batman-1/',google=JSON.parse(await fs.readFile(googleRoot+'translation-render-check.json','utf8')).find(r=>r.page===5),googleClip=[115,45,165,160];
 await capture('google-original',await fs.readFile(googleRoot+'005.jpg'),'image/jpeg',googleClip,googleRoot+'005.jpg');
 await render('google',googleRoot+'005.jpg',google.segments,googleClip,googleRoot+'translation-render-check.json');
 const gemini=JSON.parse(await fs.readFile('ocr-runs/gemini-live-7.json','utf8')),ocr=JSON.parse(await fs.readFile('ocr-runs/web-local-7.json','utf8')),rows=new Map(gemini.rows.map(r=>[r.id,r.translation]));
 const gsegment=ocr.segments.find(s=>s.id==='s2'),b=gsegment.bubble||gsegment.box,gclip=[Math.max(0,b[0]-20),Math.max(0,b[1]-20),b[2]-b[0]+40,b[3]-b[1]+40];
 await capture('gemini-original',await fs.readFile('../imagensinputteste/7.jpg'),'image/jpeg',gclip,'../imagensinputteste/7.jpg');
 await render('gemini','../imagensinputteste/7.jpg',ocr.segments.map(s=>({...s,translation:rows.get(s.id)||''})),gclip,'ocr-runs/gemini-live-7.json; model '+gemini.model);
 await fs.writeFile(out+'/provenance.json',JSON.stringify(provenance,null,2));console.log('Saved '+provenance.length+' documentation crops.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
