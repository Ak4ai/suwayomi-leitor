// Reproducible visual check: saved OCR/translations, no external API calls.
// Run: node tools/lettering-visual.cjs [label]
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const label=process.argv[2]||'current';if(!/^[a-z0-9-]+$/i.test(label))throw Error('Invalid label');
 const ocr=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/web-local-7.json'),'utf8'));
 const translations=JSON.parse(await fs.readFile(path.join(root,'ocr-runs/gemini-live-7.json'),'utf8'));
 for(const s of ocr.segments)s.translation=translations.rows.find(r=>r.id===s.id)?.translation||'';
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/visual-fixture.jpg',route=>route.fulfill({path:path.join(root,'../imagensinputteste/7.jpg'),contentType:'image/jpeg'}));
  await page.goto('http://127.0.0.1:3003');
  const output=await page.evaluate(async(segments)=>{
   const {Lettering,loadLetteringFonts}=await import('./lettering.js');
   const image=await createImageBitmap(await(await fetch('./visual-fixture.jpg')).blob());
   await loadLetteringFonts();
   const engine=new Lettering(),result=document.createElement('canvas');
   const outcome=engine.paint(result,image,segments,{translated:true,fontReady:true,scale:1});
   const clean=document.createElement('canvas');clean.width=image.width;clean.height=image.height;const cc=clean.getContext('2d');cc.drawImage(image,0,0);
   const mask=document.createElement('canvas');mask.width=image.width;mask.height=image.height;const mc=mask.getContext('2d');mc.drawImage(image,0,0);
   const report=[];
   for(const s of segments){const r=engine.region(s);report.push({id:s.id,box:s.box,bubble:s.bubble,reason:r.reason||null,suggestion:r.suggestion||null,note:outcome.notes.get(s.id)});if(r.clean){cc.drawImage(r.clean,r.x,r.y);if(r.mask){mc.drawImage(r.mask,r.x,r.y);}else{mc.strokeStyle='red';mc.lineWidth=3;mc.strokeRect(r.x,r.y,r.w,r.h);}}}
   const originals=document.createElement('canvas');originals.width=image.width;originals.height=image.height;originals.getContext('2d').drawImage(image,0,0);
   const sheets=[];
   const eligible=segments.filter(s=>s.bubble);
   for(let offset=0;offset<eligible.length;offset+=5){const group=eligible.slice(offset,offset+5),sheet=document.createElement('canvas');sheet.width=1440;sheet.height=group.length*300;const ctx=sheet.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,sheet.width,sheet.height);
    group.forEach((s,row)=>{const b=s.bubble,w=b[2]-b[0],h=b[3]-b[1],scale=Math.min(350/w,245/h);[originals,mask,clean,result].forEach((source,col)=>{ctx.fillStyle='#111';ctx.font='16px sans-serif';ctx.fillText(`${s.id} · ${['Original','Máscara','Limpeza','Tradução'][col]}`,col*360+5,row*300+20);ctx.drawImage(source,b[0],b[1],w,h,col*360+5,row*300+28,w*scale,h*scale);});ctx.font='12px sans-serif';ctx.fillStyle='#111';ctx.fillText(outcome.notes.get(s.id)||'',5,row*300+290);});
    sheets.push(sheet.toDataURL('image/png').split(',')[1]);
   }
   // Exact original toggle; no modifications allowed when translation is off.
   const originalToggle=document.createElement('canvas');engine.paint(originalToggle,image,segments,{translated:false,fontReady:true});
   const reverse=document.createElement('canvas');engine.paint(reverse,image,[...segments].reverse(),{translated:true,fontReady:true});
   const styleSheet=document.createElement('canvas');styleSheet.width=1800;styleSheet.height=600;const styleCtx=styleSheet.getContext('2d');styleCtx.fillStyle='#eee';styleCtx.fillRect(0,0,1800,600);
   for(const [row,id] of ['s2','s12'].entries()){
    const sample=segments.find(s=>s.id===id),b=sample.bubble,w=b[2]-b[0],h=b[3]-b[1],factor=Math.min(350/w,245/h);
    const variants=[['Original',null],['Regular',{family:'comic',weight:'400',slant:'normal'}],['Negrito',{family:'comic',weight:'700',slant:'normal'}],['Negrito itálico',{family:'comic',weight:'700',slant:'italic'}],['Bangers',{family:'bangers',slant:'normal'}]];
    variants.forEach(([label,letteringStyle],col)=>{let source=originals;if(letteringStyle){source=document.createElement('canvas');engine.paint(source,image,[{...sample,letteringStyle}],{translated:true,fontReady:true});}styleCtx.fillStyle='#111';styleCtx.font='18px sans-serif';styleCtx.fillText(`${id} · ${label}`,col*360+5,row*300+20);styleCtx.drawImage(source,b[0],b[1],w,h,col*360+5,row*300+35,w*factor,h*factor);});
   }
   return {applied:outcome.applied,report,sheets,styles:styleSheet.toDataURL('image/png').split(',')[1],result:result.toDataURL('image/png').split(',')[1],originalRestored:originalToggle.toDataURL()===originals.toDataURL(),orderIndependent:reverse.toDataURL()===result.toDataURL()};
  },ocr.segments);
  const dir=path.join(root,'ocr-runs',`lettering-${label}`);await fs.mkdir(dir,{recursive:true});
  for(let i=0;i<output.sheets.length;i++)await fs.writeFile(path.join(dir,`comparison-${i+1}.png`),Buffer.from(output.sheets[i],'base64'));
  await fs.writeFile(path.join(dir,'page.png'),Buffer.from(output.result,'base64'));
  await fs.writeFile(path.join(dir,'font-comparison.png'),Buffer.from(output.styles,'base64'));
  // UI check replays saved OCR, deliberately avoiding OCR latency and API cost.
  await page.route(/\/worker\.js(?:\?.*)?$/,route=>route.fulfill({headers:{'Cross-Origin-Embedder-Policy':'require-corp'},contentType:'text/javascript',body:`self.onmessage=()=>self.postMessage({type:'result',result:${JSON.stringify(ocr)}});`}));
  await page.locator('#auto-translate').uncheck();
  await page.locator('#file').setInputFiles(path.join(root,'../imagensinputteste/7.jpg'));
  await page.waitForFunction(()=>!document.querySelector('#run').disabled);
  await page.locator('#run').click();
  await page.waitForFunction(()=>document.querySelectorAll('#segments article').length>0&&document.querySelector('#cancel').disabled);
  const uiStatus=await page.locator('#lettering-status').innerText();
  const translated=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await page.locator('#overlay').uncheck();const original=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await page.locator('#overlay').check();const restored=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  const toggleWorks=original!==translated&&restored===translated;
  const balloon=page.locator('#segments article').nth(1);
  await balloon.locator('summary').click();
  await balloon.locator('[data-style="family"]').selectOption('comic');
  await balloon.locator('[data-style="weight"]').selectOption('400');
  await balloon.locator('[data-style="slant"]').selectOption('normal');
  const regular=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await balloon.locator('[data-style="weight"]').selectOption('700');
  const bold=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await balloon.locator('[data-style="weight"]').selectOption('900');
  const reinforced=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await balloon.locator('[data-style="weight"]').selectOption('700');
  await balloon.locator('[data-style="slant"]').selectOption('italic');
  const italic=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  await balloon.locator('[data-style="family"]').selectOption('bangers');
  const narrow=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  const weightLocked=await balloon.locator('[data-style="weight"]').isDisabled();
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();await(await downloadPromise).saveAs(path.join(dir,'styles-export.json'));
  const exported=JSON.parse(await fs.readFile(path.join(dir,'styles-export.json'),'utf8'));
  const styleExported=exported.segments[1].letteringStyle.family==='bangers';
  const styleSwitchWorks=regular!==bold&&bold!==reinforced&&bold!==italic&&italic!==narrow&&weightLocked&&styleExported;
  await balloon.getByText('Restaurar sugestão',{exact:true}).click();
  const styleResetWorks=await page.locator('#canvas').evaluate((c,expected)=>c.toDataURL()===expected,translated);
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(dir,'interface.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  const noMobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  const report={applied:output.applied,originalRestored:output.originalRestored,orderIndependent:output.orderIndependent,toggleWorks,styleSwitchWorks,styleResetWorks,noMobileOverflow,uiStatus,errors,regions:output.report};await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(errors.length||!output.originalRestored||!output.orderIndependent||!toggleWorks||!noMobileOverflow||!styleSwitchWorks||!styleResetWorks)throw Error('Rendering/UI regression; inspect report');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
