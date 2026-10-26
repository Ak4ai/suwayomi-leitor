// Renders one real page on the page and in render-worker.js, checks both
// outputs agree and reports the longest frame gap the interface suffers.
// INPAINT=hybrid or INPAINT=ai also exercises LaMa in its nested worker.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:3003/chapter.html');
  const root='ocr-runs/sorcerer-supreme-1/',raw=JSON.parse(await fs.readFile(root+'020.json','utf8'));
  const translations=JSON.parse(await fs.readFile('tools/fixtures/sorcerer-page20-translations.json','utf8'));
  const segments=raw.filtered.segments.map(s=>({...s,translation:translations[s.id]}));
  const data=(await fs.readFile(root+'020.jpg')).toString('base64');
  const result=await page.evaluate(async({data,segments,inpaint})=>{
   const blob=await(await fetch('data:image/jpeg;base64,'+data)).blob();
   // Longest gap between animation frames while a render runs.
   const watch=async task=>{let last=performance.now(),worst=0,running=true;const tick=now=>{worst=Math.max(worst,now-last);last=now;if(running)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    const start=performance.now();try{const value=await task();return {value,ms:performance.now()-start,worstFrame:worst};}finally{running=false;}};
   const {renderPage}=await import('./page-render.js');
   const worker=new Worker(new URL('./render-worker.js',location.href),{type:'module'});
   const inWorker=options=>new Promise((resolve,reject)=>{worker.onmessage=({data})=>{if(data.type==='result')resolve(data.result);if(data.type==='error'||data.type==='unsupported')reject(Error(data.message||data.type));};worker.onerror=e=>reject(Error(e.message));worker.postMessage({blob,segments,options});});
   const out={};
   for(const renderer of ['canvas','svg','svg-light']){
    const options={renderer,inpaint,inpaintDevice:'wasm'};
    await renderPage(blob,segments,options);await inWorker(options); // warm fonts and modules
    const main=await watch(()=>renderPage(blob,segments,options)),off=await watch(()=>inWorker(options));
    const same=main.value.applied===off.value.applied&&main.value.blob.type===off.value.blob.type&&Math.abs(main.value.blob.size-off.value.blob.size)/main.value.blob.size<.05;
    out[renderer]={applied:off.value.applied,same,mainMs:Math.round(main.ms),mainWorstFrame:Math.round(main.worstFrame),workerMs:Math.round(off.ms),workerWorstFrame:Math.round(off.worstFrame),bytes:[main.value.blob.size,off.value.blob.size]};
   }
   worker.terminate();return out;
  },{data,segments,inpaint:process.env.INPAINT||'local'});
  console.log(JSON.stringify(result));
  if(!result.canvas.same||!result.svg.same||!result['svg-light'].same||!result.canvas.applied)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
