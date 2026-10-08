const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/ocr-web/chapter.html');
  const inputs=[];for(const number of [7,12,17,18,23,24])inputs.push({number,data:(await fs.readFile(`ocr-runs/sorcerer-supreme-1/${String(number).padStart(3,'0')}.jpg`)).toString('base64')});
  const targeted=process.argv[2]==='targeted',padding=targeted?0:Number(process.argv[2]||0);
  const report=await page.evaluate(async ({inputs,padding,targeted})=>{
   const worker=new Worker('./worker.js?threads=4',{type:'module'}),rows=[];
   const run=image=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('timeout')),90000);worker.onmessage=({data})=>{if(data.type==='result'){clearTimeout(timeout);resolve(data.result);}if(data.type==='error'){clearTimeout(timeout);reject(Error(data.message));}};worker.onerror=e=>reject(Error(e.message));worker.postMessage({image,mode:'wasm',lineMerge:true,recPadding:padding,targetedPadding:targeted});});
   try{for(const input of inputs){const blob=await(await fetch('data:image/jpeg;base64,'+input.data)).blob();rows.push({page:input.number,result:await run(blob)});}}finally{worker.terminate();}return rows;
  },{inputs,padding,targeted});
  await fs.writeFile(`ocr-runs/sorcerer-supreme-1/fragment${targeted?'-targeted':padding?'-padding':''}-comparison.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(r=>({page:r.page,ocrMs:r.result.elapsedMs,segments:r.result.segments.length}))));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
