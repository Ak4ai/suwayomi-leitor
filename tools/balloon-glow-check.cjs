// Renders the text-block border for one real page, composites it the way the reader does (stretched over the
// page) and checks it: border around each line, nothing far from the text, nothing over the ink.
// Writes a zoomed crop.
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
  const result=await page.evaluate(async({data,segments})=>{
   const {renderPage}=await import('./page-render.js');
   const blob=await(await fetch('data:image/jpeg;base64,'+data)).blob();
   const start=performance.now(),out=await renderPage(blob,segments,{renderer:'svg-light',inpaint:'local'}),ms=performance.now()-start;
   const load=async b=>{const img=new Image();img.src=URL.createObjectURL(b);await img.decode();return img;};
   const pageImg=await load(out.blob);
   // Each balloon's sprite drawn at its rect, as the reader places it.
   const sprites=async which=>Promise.all(out.glows.filter(g=>g[which]).map(async g=>({img:await load(g[which].blob),rect:g[which].rect,bytes:g[which].blob.size})));
   const translatedSprites=await sprites('translated'),originalSprites=await sprites('original');
   const place=(c,list,W,H)=>{for(const {img,rect:[x,y,w,h]} of list)c.drawImage(img,x*W,y*H,w*W,h*H);};
   const W=pageImg.naturalWidth,H=pageImg.naturalHeight;
   const composite=document.createElement('canvas');composite.width=W;composite.height=H;const ctx=composite.getContext('2d');
   ctx.drawImage(pageImg,0,0);place(ctx,translatedSprites,W,H);
   // Glow alpha at full page size, as displayed.
   const g=new OffscreenCanvas(W,H),gx=g.getContext('2d');place(gx,translatedSprites,W,H);const alpha=gx.getImageData(0,0,W,H).data;
   const {ReadableLettering}=await import('./lettering.js');
   const bitmap=await createImageBitmap(blob),paint=new ReadableLettering().paint(new OffscreenCanvas(1,1),bitmap,segments,{translated:true,fontReady:true,vectorText:true});
   // Around each line: halo just outside its box, nothing far to the sides (above/below would hit the
   // neighbouring lines), little over the ink itself.
   const pageData=(()=>{const c=new OffscreenCanvas(W,H),x=c.getContext('2d');x.drawImage(pageImg,0,0);return x.getImageData(0,0,W,H).data;})();
   let near=0,nearN=0,far=0,farN=0,ink=0,inkN=0;
   const at=(x,y)=>(Math.round(y)*W+Math.round(x))*4;
   for(const item of paint.glowItems){const size=item.translated.size;for(const [x0,top,x1,bottom] of item.translated.boxes){const mid=(top+bottom)/2;
    for(const [d,isFar] of [[size*.5,false],[size*2.2,true]])for(const [x,y] of (isFar?[[x0-d,mid],[x1+d,mid]]:[[x0-d,mid],[x1+d,mid],[(x0+x1)/2,top-d],[(x0+x1)/2,bottom+d]])){if(x<0||y<0||x>=W||y>=H)continue;const a=alpha[at(x,y)+3];if(isFar){far+=a;farN++;}else{near+=a;nearN++;}}
    for(let y=Math.ceil(top);y<bottom;y+=2)for(let x=Math.ceil(x0);x<x1;x+=2){const i=at(x,y);if(pageData[i]+pageData[i+1]+pageData[i+2]<150){ink+=alpha[i+3];inkN++;}}}}
   const first=paint.glowItems[0].translated.boxes[0],cx=Math.max(0,(first[0]+first[2])/2-300),cy=Math.max(0,first[1]-150),cw=Math.min(W-cx,600),ch=Math.min(H-cy,400);
   const crop=document.createElement('canvas');crop.width=1200;crop.height=Math.round(1200*ch/cw);crop.getContext('2d').drawImage(composite,cx,cy,cw,ch,0,0,crop.width,crop.height);
   // Original text with its own (amber) glow, as shown after clicking a balloon.
   const source=await load(blob),orig=document.createElement('canvas');orig.width=W;orig.height=H;const octx=orig.getContext('2d');
   octx.drawImage(source,0,0,W,H);octx.filter='hue-rotate(-170deg) saturate(1.4)';place(octx,originalSprites,W,H);
   const cropOriginal=document.createElement('canvas');cropOriginal.width=1200;cropOriginal.height=crop.height;cropOriginal.getContext('2d').drawImage(orig,cx,cy,cw,ch,0,0,cropOriginal.width,cropOriginal.height);
   return {balloons:out.balloons.length,glowItems:paint.glowItems.length,sprites:[translatedSprites.length,originalSprites.length],glowBytes:translatedSprites.reduce((a,s)=>a+s.bytes,0),renderMs:Math.round(ms),haloNearMean:Math.round(near/nearN),haloFarMean:Math.round(far/farN),overInkMean:Math.round(ink/inkN),crop:crop.toDataURL('image/png'),cropOriginal:cropOriginal.toDataURL('image/png'),glowOriginalBytes:originalSprites.reduce((a,s)=>a+s.bytes,0)};
  },{data,segments});
  await fs.writeFile(root+'balloon-glow-zoom.png',Buffer.from(result.crop.split(',')[1],'base64'));delete result.crop;
  await fs.writeFile(root+'balloon-glow-original-zoom.png',Buffer.from(result.cropOriginal.split(',')[1],'base64'));delete result.cropOriginal;
  console.log(JSON.stringify(result));
  if(!result.glowItems||result.haloNearMean<12||result.haloFarMean>10||result.overInkMean>40)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
