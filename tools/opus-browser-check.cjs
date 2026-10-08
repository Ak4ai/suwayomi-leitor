const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),external=[];page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:'))external.push(new URL(request.url()).hostname);});page.on('console',m=>{if(m.type()==='error')console.error(m.text().slice(0,350));});await page.goto(process.argv[2]||'http://127.0.0.1:3006/chapter.html');
  const raw=JSON.parse(await fs.readFile('ocr-runs/sorcerer-supreme-1/020.json','utf8')),reference=JSON.parse(await fs.readFile('tools/fixtures/sorcerer-page20-translations.json','utf8'));
  const items=[{id:'coverage',sourceText:"I DON'T KNOW. I'M...JUST ONE PERSON. I DON'T KNOW HOW TO FIX THE WORLD."},...raw.filtered.segments];
  const sentenceCase=process.argv[3]==='sentence';
  const inputs=sentenceCase?items.map(item=>({...item,sourceText:item.sourceText.replace(/\s+/g,' ').trim().toLowerCase().replace(/\bi\b/g,'I').replace(/(^|[.!?]\s+)([a-z])/g,(_,prefix,letter)=>prefix+letter.toUpperCase())})):items;
  const target=process.argv[4]||'pt_BR',variant=process.argv[5]||'compact';
  const report=await page.evaluate(async ({items,target,variant})=>{
   const {LocalTranslator}=await import('./translation-local.js'),translator=new LocalTranslator({target,variant}),rows=[];
   try{
    const first=await translator.translate([items[0]],AbortSignal.timeout(180000));const coldMetrics=translator.lastMetrics;
    const warm=await translator.translate(items.slice(1),AbortSignal.timeout(180000),()=>{},(id,translation)=>rows.push({id,translation}));
    return {cold:{source:items[0].sourceText,translation:first.get(items[0].id),metrics:coldMetrics},warm:{metrics:translator.lastMetrics,rows},network:{remoteModelFetches:false}};
   }finally{translator.stop();}
  },{items:inputs,target,variant});
  for(const row of report.warm.rows){row.source=items.find(item=>item.id===row.id).sourceText;row.reference=reference[row.id];}
  report.network={externalHosts:[...new Set(external)],sourceVariant:sentenceCase?'sentence-case':'original',target,variant};
  await fs.writeFile(`ocr-runs/sorcerer-supreme-1/opus${variant==='big'?'-big':''}${sentenceCase?'-sentence':''}${target==='pt'?'-pt':''}-check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
