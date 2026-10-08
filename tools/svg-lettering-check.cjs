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
   const {ReadableLettering,loadLetteringFonts}=await import('./lettering.js'),{renderLetteringSVG}=await import('./lettering-svg.js');await loadLetteringFonts();
   const image=await createImageBitmap(await(await fetch('data:image/jpeg;base64,'+data)).blob());
   try{
    const canvas=document.createElement('canvas'),start=performance.now(),raster=new ReadableLettering().paint(canvas,image,segments,{translated:true,fontReady:true}),canvasMs=performance.now()-start;
    const vectorStart=performance.now(),vector=await renderLetteringSVG(image,segments),svgMs=performance.now()-vectorStart;
    const parsed=new DOMParser().parseFromString(vector.svg,'image/svg+xml');if(parsed.querySelector('parsererror'))throw Error('Invalid SVG');
    const src=URL.createObjectURL(vector.blob),img=new Image();try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('SVG image failed'));img.src=src;});
     const output=document.createElement('canvas');output.width=image.width;output.height=image.height;output.getContext('2d').drawImage(img,0,0);
     const zoom=document.createElement('canvas');zoom.width=1200;zoom.height=800;zoom.getContext('2d').drawImage(img,630,180,440,300,0,0,1200,800);
     const textNodes=[...parsed.querySelectorAll('text')].map(node=>node.textContent);
     const fullText=vector.textLayers.every(layer=>{const segment=segments.find(s=>s.id===layer.id);return layer.lines.map(line=>line.text).join(' ').replace(/\s+/g,' ').trim()===segment.translation.replace(/\s+/g,' ').trim();});
     const originalDimensions=img.naturalWidth===image.width&&img.naturalHeight===image.height;
     if(!fullText||!originalDimensions||!textNodes.length)throw Error('SVG text/dimensions regression');
     return {canvasApplied:raster.applied,svgApplied:vector.applied,notes:[...vector.notes],cleanupQuality:[...vector.cleanupQuality],canvasMs,svgMs,svgBytes:vector.blob.size,fullText,originalDimensions,textNodes:textNodes.length,embeddedFonts:parsed.querySelector('style').textContent.includes('data:font/ttf;base64'),externalResources:[...parsed.querySelectorAll('[href]')].some(node=>!node.getAttribute('href').startsWith('data:')),svg:vector.svg,raster:canvas.toDataURL(),vector:output.toDataURL(),zoom:zoom.toDataURL()};
    }finally{URL.revokeObjectURL(src);}
   }finally{image.close();}
  },{data,segments});
  await fs.writeFile(root+'page20-translated.svg',result.svg);delete result.svg;
  for(const key of ['raster','vector','zoom']){await fs.writeFile(root+'svg-'+key+'.png',Buffer.from(result[key].split(',')[1],'base64'));delete result[key];}
  await fs.writeFile(root+'svg-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
