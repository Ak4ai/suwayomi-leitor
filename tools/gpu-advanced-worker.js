// Full-page diagnostic pipeline. Experimental assets never replace reader files.
import * as ort from './vendor/ort.webgpu.min.mjs';
import {suppress,clampBox,lineComponents,decodeCTC} from './vision.js';
import {GpuCTC} from './gpu-ctc.js';
ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
ort.env.wasm.numThreads=4;
ort.env.logLevel='warning';
function inputData(image,box,width,height,padWidth=width,normalized=false,bgr=false){
 const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='white';ctx.fillRect(0,0,width,height);ctx.drawImage(image,box[0],box[1],box[2]-box[0],box[3]-box[1],0,0,width,height);
 const pixels=ctx.getImageData(0,0,width,height).data,data=new Float32Array(3*padWidth*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){const v=pixels[(y*width+x)*4+(bgr?2-c:c)]/255;data[c*padWidth*height+y*padWidth+x]=normalized?(v-.5)/.5:v;}
 return data;
}
const dispose=outputs=>{for(const value of Object.values(outputs))value.dispose();};
async function extract(image,detector,lines){
 const feeds={images:new ort.Tensor('float32',inputData(image,[0,0,image.width,image.height],640,640),[1,3,640,640]),orig_target_sizes:new ort.Tensor('int64',BigInt64Array.from([BigInt(image.width),BigInt(image.height)]),[1,2])};
 const output=await detector.run(feeds),[labels,boxes,scores]=detector.outputNames.map(name=>output[name].data),regions=[];
 for(let i=0;i<scores.length;i++)if(scores[i]>=.3&&[1,2].includes(Number(labels[i])))regions.push({box:clampBox(Array.from(boxes.slice(i*4,i*4+4)),image.width,image.height),score:scores[i]});
 dispose(output);dispose(feeds);
 const textRegions=suppress(regions).filter(r=>r.box[2]-r.box[0]>4&&r.box[3]-r.box[1]>4).sort((a,b)=>a.box[1]-b.box[1]||a.box[0]-b.box[0]),inputs=[];
 for(let regionIndex=0;regionIndex<textRegions.length;regionIndex++){
  const box=textRegions[regionIndex].box,w=box[2]-box[0],h=box[3]-box[1],scale=Math.min(2,960/Math.max(w,h)),dw=Math.max(32,Math.round(w*scale/32)*32),dh=Math.max(32,Math.round(h*scale/32)*32);
  const input=new ort.Tensor('float32',inputData(image,box,dw,dh,dw,true,true),[1,3,dh,dw]);
  const outputs=await lines.run({[lines.inputNames[0]]:input}),map=outputs[lines.outputNames[0]],components=lineComponents(map.data,map.dims.at(-1),map.dims.at(-2),w,h);
  dispose(outputs);input.dispose();
  for(const line of components){const absolute=[line.box[0]+box[0],line.box[1]+box[1],line.box[2]+box[0],line.box[3]+box[1]],rw=Math.max(8,Math.min(2048,Math.ceil(48*(absolute[2]-absolute[0])/Math.max(1,absolute[3]-absolute[1]))));
   inputs.push({index:inputs.length,regionIndex,box:absolute,width:Math.max(320,rw),data:inputData(image,absolute,rw,48,Math.max(320,rw),true,true)});
  }
 }
 return {inputs,textRegions};
}
function batchesFor(inputs,variant){
 if(variant.uniform){const width=Math.ceil(Math.max(...inputs.map(i=>i.width))/64)*64,batches=[];for(let i=0;i<inputs.length;i+=8)batches.push({width,items:inputs.slice(i,i+8),n:8});return batches;}
 if(!variant.bucket)return inputs.map(i=>({width:i.width,items:[i],n:1}));
 const groups=new Map();for(const i of inputs){const width=Math.ceil(i.width/64)*64;if(!groups.has(width))groups.set(width,[]);groups.get(width).push(i);}
 const batches=[];for(const [width,items] of groups)for(let i=0;i<items.length;i+=8){const batch=items.slice(i,i+8);batches.push({width,items:batch,n:variant.fixed?8:batch.length});}return batches;
}
function fillBatch(batch,data){
 data.fill(0);batch.items.forEach((item,i)=>{for(let c=0;c<3;c++)for(let y=0;y<48;y++)data.set(item.data.subarray((c*48+y)*item.width,(c*48+y+1)*item.width),(i*3*48+c*48+y)*batch.width);});return data;
}
self.onmessage=async({data:job})=>{
 let detector,lines;
 try{
  const manifest=await(await fetch('./models.json')).json(),bytes=async url=>await(await fetch(url)).arrayBuffer();
  detector=await ort.InferenceSession.create(await bytes(manifest.models.detector.url),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  lines=await ort.InferenceSession.create(await bytes(manifest.models.lines.url),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
  const fp32=await bytes(manifest.models.recognizer.url),reports=[];
  const variants=[{name:'fp32-sequential'},{name:'fp32-batch64',bucket:true},{name:'fp32-fixed-buffers',bucket:true,fixed:true,buffers:true},{name:'fp32-capture',bucket:true,fixed:true,buffers:true,capture:true},{name:'fp32-capture-one-shape',bucket:true,fixed:true,buffers:true,capture:true,uniform:true},{name:'fp32-gpu-ctc',ctc:true},{name:'fp16-sequential',fp16:true},{name:'fp16-gpu-ctc',fp16:true,ctc:true},{name:'v5-wasm',wasm:true},{name:'v6-tiny-wasm',wasm:true,v6:'tiny'},{name:'v6-small-wasm',wasm:true,v6:'small'},{name:'v6-tiny-gpu',v6:'tiny'}].filter(v=>job.variants?job.variants.includes(v.name):!v.wasm&&!v.v6);
  for(const variant of variants){
   const resources=new Map(),sessions=new Map();let ctc;
   const report={variant:variant.name,runs:[],supported:true};reports.push(report);
   try{
    const model=variant.v6?await bytes(`./experimental/${variant.v6}.onnx`):variant.fp16?await bytes('./experimental/recognizer-fp16.onnx'):fp32;
    let characters=manifest.characters;
    if(variant.v6){const text=await(await fetch(`./experimental/${variant.v6}-dict.txt`)).text();characters=['',...text.replace(/\r/g,'').split('\n').filter((line,i,rows)=>i!==rows.length-1||line!==''),' '];}
    const getSession=async batch=>{
     const key=variant.fixed?batch.width:'dynamic';
     if(!sessions.has(key)){
      const options={executionProviders:variant.wasm?['wasm']:['webgpu'],graphOptimizationLevel:'all'};
      if(variant.ctc||variant.capture)options.preferredOutputLocation='gpu-buffer';
      if(variant.fixed)options.freeDimensionOverrides={'DynamicDimension.0':8,'DynamicDimension.1':batch.width,'?':48};
      if(variant.capture)options.enableGraphCapture=true;
      sessions.set(key,await ort.InferenceSession.create(model,options));
     }
     return sessions.get(key);
    };
    let initializationMs=0;
    for(let iteration=0;iteration<5;iteration++){
     const start=performance.now(),image=await createImageBitmap(job.image);let extraction;
     try{extraction=await extract(image,detector,lines);}finally{image.close();}
     const extractionMs=performance.now()-start,{inputs,textRegions}=extraction,batches=batchesFor(inputs,variant),texts=new Array(inputs.length);let recMs=0,downloadBytes=0,probabilityBytes=0;
     const recStart=performance.now();
     for(const batch of batches){
      const initStart=performance.now(),session=await getSession(batch);initializationMs+=performance.now()-initStart;
      const {width,n}=batch;let resource,tensor;
      if(variant.buffers){
       const key=`${n}-${width}`;resource=resources.get(key);
       if(!resource){const device=ort.env.webgpu.device,data=new Float32Array(n*3*48*width),buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});resource={data,buffer,tensor:ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims:[n,3,48,width]})};
        if(variant.capture){
         const dims=[n,width/8,characters.length],size=dims.reduce((a,b)=>a*b,1)*4;
         resource.outputBuffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});resource.readBuffer=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
         resource.outputTensor=ort.Tensor.fromGpuBuffer(resource.outputBuffer,{dataType:'float32',dims});resource.outputBytes=size;
        }
        resources.set(key,resource);
       }
       ort.env.webgpu.device.queue.writeBuffer(resource.buffer,0,fillBatch(batch,resource.data));tensor=resource.tensor;
      }else tensor=new ort.Tensor('float32',fillBatch(batch,new Float32Array(n*3*48*width)),[n,3,48,width]);
      const tick=performance.now(),outputs=await session.run({[session.inputNames[0]]:tensor},variant.capture?{[session.outputNames[0]]:resource.outputTensor}:undefined),value=outputs[session.outputNames[0]];let decoded;
      if(variant.ctc){ctc??=new GpuCTC(ort.env.webgpu.device);decoded=await ctc.decode(value,characters);downloadBytes+=value.dims[0]*value.dims.at(-2)*8;}
      else{
       let cpu;
       if(variant.capture){const device=ort.env.webgpu.device,encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(resource.outputBuffer,0,resource.readBuffer,0,resource.outputBytes);device.queue.submit([encoder.finish()]);await resource.readBuffer.mapAsync(GPUMapMode.READ);cpu=new Float32Array(resource.readBuffer.getMappedRange().slice(0));resource.readBuffer.unmap();}
       else cpu=value.location==='gpu-buffer'?await value.getData():value.data;
       const stride=value.dims.at(-2)*value.dims.at(-1);decoded=Array.from({length:n},(_,i)=>decodeCTC(cpu.subarray(i*stride,(i+1)*stride),value.dims,characters));downloadBytes+=cpu.byteLength;
      }
      probabilityBytes+=value.size*4;recMs+=performance.now()-tick;
      batch.items.forEach((item,i)=>texts[item.index]=decoded[i]);if(!variant.capture)dispose(outputs);if(!resource)tensor.dispose();
     }
     report.runs.push({iteration,totalMs:performance.now()-start,extractionMs,recognitionTotalMs:performance.now()-recStart,runAndDecodeMs:recMs,texts,boxes:inputs.map(i=>i.box),regions:textRegions.length,calls:batches.length,downloadBytes,probabilityBytes,allocatedInputBytes:[...resources.values()].reduce((sum,r)=>sum+r.data.byteLength,0),sessions:sessions.size});
     self.postMessage({type:'progress',variant:variant.name,iteration,totalMs:report.runs.at(-1).totalMs});
    }
    report.initializationMs=initializationMs;
   }catch(error){report.supported=false;report.error=error.stack||String(error);self.postMessage({type:'progress',variant:variant.name,error:report.error});}
   finally{ctc?.dispose();for(const s of sessions.values())await s.release().catch(()=>{});for(const r of resources.values()){r.tensor.dispose();r.outputTensor?.dispose();r.buffer.destroy();r.outputBuffer?.destroy();r.readBuffer?.destroy();}}
  }
  self.postMessage({type:'result',reports});
 }catch(error){self.postMessage({type:'error',message:error.stack||String(error)});}
 finally{await detector?.release();await lines?.release();}
};
