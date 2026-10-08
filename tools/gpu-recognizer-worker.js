// Diagnostic worker served by the test harness; never selected by the reader.
import * as ort from './vendor/ort.webgpu.min.mjs';
import {decodeCTC} from './vision.js';
ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
ort.env.wasm.numThreads=4;
ort.env.logLevel='warning';
self.onmessage=async({data:job})=>{
 let image,session;
 try{
  const manifest=await(await fetch('./models.json')).json();
  image=await createImageBitmap(job.image);
  const inputs=job.boxes.map((box,index)=>{
   const width=Math.max(8,Math.min(2048,Math.ceil(48*(box[2]-box[0])/Math.max(1,box[3]-box[1])))),padWidth=Math.max(320,width);
   const canvas=new OffscreenCanvas(width,48),ctx=canvas.getContext('2d');
   ctx.fillStyle='white';ctx.fillRect(0,0,width,48);ctx.drawImage(image,box[0],box[1],box[2]-box[0],box[3]-box[1],0,0,width,48);
   const rgba=ctx.getImageData(0,0,width,48).data,data=new Float32Array(3*padWidth*48);
   for(let y=0;y<48;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[c*padWidth*48+y*padWidth+x]=(rgba[(y*width+x)*4+2-c]/255-.5)/.5;
   return {index,width:padWidth,data};
  });
  session=await ort.InferenceSession.create(await(await fetch(manifest.models.recognizer.url)).arrayBuffer(),{executionProviders:['webgpu','wasm'],graphOptimizationLevel:'all'});
  if(job.captureOnly){
   const batch=inputs.filter(i=>i.width===320).slice(0,8),width=320,data=new Float32Array(batch.length*3*48*width);
   batch.forEach((item,i)=>data.set(item.data,i*item.data.length));
   const baselineTensor=new ort.Tensor('float32',data,[batch.length,3,48,width]);
   const baselineOutput=await session.run({[session.inputNames[0]]:baselineTensor});
   const values=baselineOutput[session.outputNames[0]],stride=values.dims.at(-2)*values.dims.at(-1);
   const baseline=batch.map((item,i)=>decodeCTC(values.data.subarray(i*stride,(i+1)*stride),values.dims,manifest.characters).text);
   baselineTensor.dispose();for(const value of Object.values(baselineOutput))value.dispose();
   const baselineRuns=[];
   for(let i=0;i<3;i++){
    const tensor=new ort.Tensor('float32',data,[batch.length,3,48,width]),started=performance.now();
    const outputs=await session.run({[session.inputNames[0]]:tensor}),value=outputs[session.outputNames[0]];
    batch.forEach((item,j)=>decodeCTC(value.data.subarray(j*stride,(j+1)*stride),value.dims,manifest.characters));
    baselineRuns.push(performance.now()-started);tensor.dispose();for(const value of Object.values(outputs))value.dispose();
   }
   await session.release();session=null;
   let buffer,tensor;
   try{
    session=await ort.InferenceSession.create(await(await fetch(manifest.models.recognizer.url)).arrayBuffer(),{
     executionProviders:['webgpu'],enableGraphCapture:true,preferredOutputLocation:'gpu-buffer',
     freeDimensionOverrides:{'DynamicDimension.0':batch.length,'DynamicDimension.1':width,'?':48},graphOptimizationLevel:'all'
    });
    const device=ort.env.webgpu.device;
    buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(buffer,0,data);
    tensor=ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims:[batch.length,3,48,width]});
    const runs=[];
    for(let iteration=0;iteration<4;iteration++){
     const started=performance.now(),outputs=await session.run({[session.inputNames[0]]:tensor});
     const value=outputs[session.outputNames[0]],cpu=await value.getData(),stride=value.dims.at(-2)*value.dims.at(-1);
     const texts=batch.map((item,i)=>decodeCTC(cpu.subarray(i*stride,(i+1)*stride),value.dims,manifest.characters).text);
     runs.push({elapsedMs:performance.now()-started,texts});
     for(const value of Object.values(outputs))value.dispose();
    }
    const reversed=new Float32Array(data.length);batch.forEach((item,i)=>reversed.set(batch[batch.length-i-1].data,i*item.data.length));
    device.queue.writeBuffer(buffer,0,reversed);
    const outputs=await session.run({[session.inputNames[0]]:tensor}),value=outputs[session.outputNames[0]],cpu=await value.getData();
    const changedTexts=batch.map((item,i)=>decodeCTC(cpu.subarray(i*stride,(i+1)*stride),value.dims,manifest.characters).text);
    for(const value of Object.values(outputs))value.dispose();
    self.postMessage({type:'result',capture:{supported:true,baseline,baselineRuns,runs,identical:runs.every(r=>JSON.stringify(r.texts)===JSON.stringify(baseline)),changedInputWorks:JSON.stringify(changedTexts)===JSON.stringify([...baseline].reverse())}});
   }catch(error){self.postMessage({type:'result',capture:{supported:false,message:error.message||String(error)}});}
   finally{tensor?.dispose();buffer?.destroy();}
   return;
  }
  const reports=[];
  for(const [batchSize,bucket,gpuInput] of [[1,0,false],[8,0,false],[8,64,false],[8,128,false],[8,64,true]]){
   const groups=new Map();for(const input of inputs){const width=bucket?Math.ceil(input.width/bucket)*bucket:input.width;if(!groups.has(width))groups.set(width,[]);groups.get(width).push({...input,batchWidth:width});}
   const batches=[];for(const group of groups.values())for(let i=0;i<group.length;i+=batchSize)batches.push(group.slice(i,i+batchSize));
   const runs=[];
   for(let iteration=0;iteration<3;iteration++){
    const started=performance.now(),texts=new Array(inputs.length);let inferenceMs=0;
    for(const batch of batches){
     const width=batch[0].batchWidth,data=new Float32Array(batch.length*3*48*width);
     batch.forEach((item,i)=>{for(let c=0;c<3;c++)for(let y=0;y<48;y++)data.set(item.data.subarray((c*48+y)*item.width,(c*48+y+1)*item.width),(i*3*48+c*48+y)*width);});
     let buffer;
     if(gpuInput){buffer=ort.env.webgpu.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});ort.env.webgpu.device.queue.writeBuffer(buffer,0,data);}
     const tensor=gpuInput?ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims:[batch.length,3,48,width]}):new ort.Tensor('float32',data,[batch.length,3,48,width]);
     const tick=performance.now();
     const outputs=await session.run({[session.inputNames[0]]:tensor});inferenceMs+=performance.now()-tick;
     const output=outputs[session.outputNames[0]],stride=output.dims.at(-2)*output.dims.at(-1);
     batch.forEach((item,i)=>texts[item.index]=decodeCTC(output.data.subarray(i*stride,(i+1)*stride),output.dims,manifest.characters));
     tensor.dispose();buffer?.destroy();for(const value of Object.values(outputs))value.dispose();
    }
    runs.push({iteration,elapsedMs:performance.now()-started,inferenceMs,texts});
   }
   reports.push({batchSize,bucket,gpuInput,calls:batches.length,widths:[...groups.keys()],runs});
   self.postMessage({type:'progress',batchSize:`${batchSize}, bucket ${bucket}, GPU input ${gpuInput}`});
  }
  self.postMessage({type:'result',reports});
 }catch(e){self.postMessage({type:'error',message:e.stack||String(e)});}
 finally{image?.close();await session?.release();}
};
