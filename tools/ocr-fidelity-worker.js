// Fixed crops isolate recognition accuracy from detector differences.
import * as ort from './vendor/ort.webgpu.min.mjs';
import {decodeCTC} from './vision.js';
import {GpuCTC} from './gpu-ctc.js';
ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
ort.env.wasm.numThreads=4;
ort.env.logLevel='warning';
self.onmessage=async({data:job})=>{
 let image;
 try{
  const manifest=await(await fetch('./models.json')).json();
  image=await createImageBitmap(job.image);
  const inputs=job.entries.map(entry=>{
   const box=entry.box,width=Math.max(8,Math.min(2048,Math.ceil(48*(box[2]-box[0])/Math.max(1,box[3]-box[1])))),padWidth=Math.max(320,width);
   const canvas=new OffscreenCanvas(width,48),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,width,48);ctx.drawImage(image,box[0],box[1],box[2]-box[0],box[3]-box[1],0,0,width,48);
   const pixels=ctx.getImageData(0,0,width,48).data,data=new Float32Array(3*48*padWidth);
   for(let y=0;y<48;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[c*48*padWidth+y*padWidth+x]=(pixels[(y*width+x)*4+2-c]/255-.5)/.5;
   return {id:entry.id,width:padWidth,data};
  });
  const specs=[{name:'v5-en',url:manifest.models.recognizer.url,characters:manifest.characters}];
  for(const name of ['tiny','small']){
   const text=await(await fetch(`./experimental/${name}-dict.txt`)).text();
   const characters=['',...text.replace(/\r/g,'').split('\n').filter((line,i,rows)=>i!==rows.length-1||line!==''),' '];
   specs.push({name:`v6-${name}`,url:`./experimental/${name}.onnx`,characters});
  }
  const reports=[];
  // Alternating model order reduces systematic bias from warming the PC.
  for(const [pass,order] of [[0,[0,1,2]],[1,[2,1,0]]])for(const specIndex of order){
   const spec=specs[specIndex],model=await(await fetch(spec.url)).arrayBuffer();
   for(const mode of job.modes||['wasm','gpu','gpu-ctc']){
    const report={name:spec.name,mode,pass,bytes:model.byteLength,characterCount:spec.characters.length,runs:[],supported:true};reports.push(report);
    let session,ctc;
    try{
     const started=performance.now();
     session=await ort.InferenceSession.create(model,{executionProviders:mode==='wasm'?['wasm']:['webgpu'],graphOptimizationLevel:'all',...(mode==='gpu-ctc'?{preferredOutputLocation:'gpu-buffer'}:{})});
     report.initializationMs=performance.now()-started;
     for(let iteration=0;iteration<3;iteration++){
      const start=performance.now(),texts=[];let inferenceMs=0,decodeMs=0,downloadBytes=0;
      for(const input of inputs){
       const tensor=new ort.Tensor('float32',input.data,[1,3,48,input.width]),tick=performance.now(),outputs=await session.run({[session.inputNames[0]]:tensor});inferenceMs+=performance.now()-tick;
       const value=outputs[session.outputNames[0]],decodeStart=performance.now();let decoded;
       if(mode==='gpu-ctc'){ctc??=new GpuCTC(ort.env.webgpu.device);decoded=(await ctc.decode(value,spec.characters))[0];downloadBytes+=value.dims.at(-2)*8;}
       else{decoded=decodeCTC(value.data,value.dims,spec.characters);downloadBytes+=value.data.byteLength;}
       decodeMs+=performance.now()-decodeStart;texts.push({id:input.id,...decoded});tensor.dispose();for(const output of Object.values(outputs))output.dispose();
      }
      report.runs.push({iteration,elapsedMs:performance.now()-start,inferenceMs,decodeMs,downloadBytes,texts});
      self.postMessage({type:'progress',name:spec.name,mode,pass,iteration,elapsedMs:report.runs.at(-1).elapsedMs});
     }
    }catch(error){report.supported=false;report.error=error.stack||String(error);self.postMessage({type:'progress',name:spec.name,mode,pass,error:report.error});}
    finally{ctc?.dispose();await session?.release().catch(()=>{});}
   }
  }
  self.postMessage({type:'result',reports});
 }catch(error){self.postMessage({type:'error',message:error.stack||String(error)});}
 finally{image?.close();}
};
