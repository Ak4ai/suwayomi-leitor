// Deterministic check for ties, blanks, repeated characters and batch isolation.
const {chromium}=require('../node_modules/ocr-check/node_modules/playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.route('**/gpu-ctc.js',r=>r.fulfill({path:path.join(__dirname,'gpu-ctc.js'),contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:3003');
  const report=await page.evaluate(async()=>{
   const {GpuCTC}=await import('./gpu-ctc.js'),{decodeCTC}=await import('./vision.js'),device=await(await navigator.gpu.requestAdapter()).requestDevice();
   const data=Float32Array.from([0,.9,.9,0,0,.9,0,0,1,0,0,0,0,.8,0,0,0,0,.7,.7,0,0,.7,0,1,0,0,0,0,0,0,.6]),dims=[2,4,4],characters=['','A','B','C'];
   const buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),decoder=new GpuCTC(device);device.queue.writeBuffer(buffer,0,data);
   try{
    const cpu=[decodeCTC(data.subarray(0,16),dims,characters),decodeCTC(data.subarray(16),dims,characters)],gpu=await decoder.decode({type:'float32',location:'gpu-buffer',dims,gpuBuffer:buffer},characters);
    return {cpu,gpu};
   }finally{decoder.dispose();buffer.destroy();device.destroy();}
  });
  assert.deepEqual(report.gpu,report.cpu);assert.deepEqual(report.gpu.map(r=>r.text),['AA','BC']);console.log(JSON.stringify({passed:true,...report}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
