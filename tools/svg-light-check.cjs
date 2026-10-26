// Renders one real page as SVG and as light SVG (JPEG background, shared
// glyphs). Text must match pixel for pixel; the background may only differ
// by JPEG noise. Writes zoomed crops of the first balloon for visual review.
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
   const {loadLetteringFonts}=await import('./lettering.js'),{renderLetteringSVG}=await import('./lettering-svg.js');await loadLetteringFonts();
   const image=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+data)).blob());
   const timed=async light=>{await renderLetteringSVG(image,segments,{light});const start=performance.now(),value=await renderLetteringSVG(image,segments,{light});return {value,ms:performance.now()-start};};
   const full=await timed(false),light=await timed(true);
   const show=async blob=>{const img=new Image(),src=URL.createObjectURL(blob),start=performance.now();img.src=src;await img.decode();const ms=performance.now()-start;return {img,ms};};
   const a=await show(full.value.blob),b=await show(light.value.blob);
   const w=a.img.naturalWidth,h=a.img.naturalHeight;
   const pixels=img=>{const c=new OffscreenCanvas(w,h),x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,w,h).data;};
   // Text only: same SVGs without the background image.
   const textOnly=async svg=>(await show(new Blob([svg.replace(/<image [^>]*\/>/,'')],{type:'image/svg+xml'}))).img;
   const ta=pixels(await textOnly(full.value.svg)),tb=pixels(await textOnly(light.value.svg));
   let ink=0,textDiff=0;for(let i=3;i<ta.length;i+=4){if(ta[i]>128||tb[i]>128)ink++;if(Math.abs(ta[i]-tb[i])>128)textDiff++;}
   const pa=pixels(a.img),pb=pixels(b.img);let sum=0,max=0;for(let i=0;i<pa.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(pa[i+c]-pb[i+c]);sum+=d;if(d>max)max=d;}
   const parsed=new DOMParser().parseFromString(light.value.svg,'image/svg+xml');
   const line=light.value.textLayers[0].lines[0],cx=Math.max(0,line.x-220),cy=Math.max(0,line.y-150);
   const crop=img=>{const c=document.createElement('canvas');c.width=1200;c.height=800;c.getContext('2d').drawImage(img,cx,cy,440,300,0,0,1200,800);return c.toDataURL('image/png');};
   // Small scan (30%): the raster is upscaled for Canvas letters, but the
   // light SVG must embed the background at the source size.
   const k=.3,sw=Math.round(image.width*k),sh=Math.round(image.height*k),small=await createImageBitmap(image,{resizeWidth:sw,resizeHeight:sh,resizeQuality:'high'});
   const scaleBox=b=>b&&b.map(v=>v*k),smallSegments=segments.map(x=>({...x,box:scaleBox(x.box),bubble:scaleBox(x.bubble),lines:x.lines.map(l=>({...l,box:scaleBox(l.box)}))}));
   const smallFull=await renderLetteringSVG(small,smallSegments),smallLight=await renderLetteringSVG(small,smallSegments,{light:true});
   const embeddedSize=async svg=>{const bmp=await createImageBitmap(await(await fetch(svg.match(/href="(data:[^"]+)"/)[1])).blob());const size=[bmp.width,bmp.height];bmp.close();return size;};
   const sa=await show(smallFull.blob),sb=await show(smallLight.blob),sp=img=>{const c=new OffscreenCanvas(sa.img.naturalWidth,sa.img.naturalHeight),x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,c.width,c.height).data;};
   const qa=sp(sa.img),qb=sp(sb.img);let smallSum=0;for(let i=0;i<qa.length;i+=4)for(let c=0;c<3;c++)smallSum+=Math.abs(qa[i+c]-qb[i+c]);
   const smallLine=smallLight.textLayers[0].lines[0],scx=Math.max(0,smallLine.x-220),scy=Math.max(0,smallLine.y-150);
   const smallCrop=img=>{const c=document.createElement('canvas');c.width=1200;c.height=800;c.getContext('2d').drawImage(img,scx,scy,440,300,0,0,1200,800);return c.toDataURL('image/png');};
   const smallReport={source:[sw,sh],declared:[sb.img.naturalWidth,sb.img.naturalHeight],embeddedFull:await embeddedSize(smallFull.svg),embeddedLight:await embeddedSize(smallLight.svg),applied:[smallFull.applied,smallLight.applied],
    mb:[+(smallFull.blob.size/1e6).toFixed(2),+(smallLight.blob.size/1e6).toFixed(2)],decodeMs:[Math.round(sa.ms),Math.round(sb.ms)],meanChannelDiff:+(smallSum/(qa.length/4*3)).toFixed(2),crops:[smallCrop(sa.img),smallCrop(sb.img)]};
   small.close();image.close();
   return {small:smallReport,applied:[full.value.applied,light.value.applied],valid:!parsed.querySelector('parsererror'),uses:parsed.querySelectorAll('use').length,glyphDefs:parsed.querySelectorAll('defs > path').length,
    mb:[+(full.value.blob.size/1e6).toFixed(2),+(light.value.blob.size/1e6).toFixed(2)],renderMs:[Math.round(full.ms),Math.round(light.ms)],decodeMs:[Math.round(a.ms),Math.round(b.ms)],
    textDiffRatio:+(textDiff/ink).toFixed(5),meanChannelDiff:+(sum/(w*h*3)).toFixed(2),crops:[crop(a.img),crop(b.img)]};
  },{data,segments});
  await fs.writeFile(root+'svg-full-zoom.png',Buffer.from(result.crops[0].split(',')[1],'base64'));
  await fs.writeFile(root+'svg-light-zoom.png',Buffer.from(result.crops[1].split(',')[1],'base64'));delete result.crops;
  await fs.writeFile(root+'svg-small-full-zoom.png',Buffer.from(result.small.crops[0].split(',')[1],'base64'));
  await fs.writeFile(root+'svg-small-light-zoom.png',Buffer.from(result.small.crops[1].split(',')[1],'base64'));delete result.small.crops;
  console.log(JSON.stringify(result));
  if(!result.valid||result.applied[0]!==result.applied[1]||!result.uses||result.textDiffRatio>.001||result.meanChannelDiff>3||result.small.embeddedLight[0]!==result.small.source[0]||result.small.declared[0]!==result.small.embeddedFull[0]||result.small.applied[0]!==result.small.applied[1])process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
