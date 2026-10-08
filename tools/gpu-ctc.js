// GPU argmax for float32 OCR probabilities; CTC collapse remains on CPU.
export class GpuCTC {
 constructor(device){this.device=device;this.pipelines=new Map();this.buffers=new Map();this.downloadBytes=0;this.fullProbabilityBytes=0;}
 async decode(output,characters){
  if(output.type!=='float32'||output.location!=='gpu-buffer')throw Error('GPU CTC requires float32 GPU output');
  const classes=output.dims.at(-1),steps=output.dims.at(-2),batch=output.dims[0],rows=batch*steps;
  if(classes!==characters.length)throw Error('Character dictionary mismatch');
  let pipeline=this.pipelines.get(classes);
  if(!pipeline){
   const module=this.device.createShaderModule({code:`
    @group(0) @binding(0) var<storage,read> probabilities: array<f32>;
    struct Winner {index:u32, score:f32};
    @group(0) @binding(1) var<storage,read_write> winners:array<Winner>;
    var<workgroup> scores:array<f32,128>;
    var<workgroup> indices:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>){
     let row=group.x;let lane=local.x;var best=-3.402823e38;var index=0u;
     for(var c=lane;c<${classes}u;c+=128u){let value=probabilities[row*${classes}u+c];if(value>best||(value==best&&c<index)){best=value;index=c;}}
     scores[lane]=best;indices[lane]=index;workgroupBarrier();
     for(var stride=64u;stride>0u;stride/=2u){
      if(lane<stride){let other=scores[lane+stride];let otherIndex=indices[lane+stride];if(other>scores[lane]||(other==scores[lane]&&otherIndex<indices[lane])){scores[lane]=other;indices[lane]=otherIndex;}}
      workgroupBarrier();
     }
     if(lane==0u){winners[row].index=indices[0];winners[row].score=scores[0];}
    }`});
   pipeline=await this.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});this.pipelines.set(classes,pipeline);
  }
  let buffers=this.buffers.get(rows);
  if(!buffers){buffers={out:this.device.createBuffer({size:rows*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read:this.device.createBuffer({size:rows*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})};this.buffers.set(rows,buffers);}
  const bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output.gpuBuffer}},{binding:1,resource:{buffer:buffers.out}}]});
  const encoder=this.device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(rows);pass.end();encoder.copyBufferToBuffer(buffers.out,0,buffers.read,0,rows*8);this.device.queue.submit([encoder.finish()]);
  await buffers.read.mapAsync(GPUMapMode.READ);const copy=buffers.read.getMappedRange().slice(0);buffers.read.unmap();
  const indices=new Uint32Array(copy),scores=new Float32Array(copy),results=[];
  for(let i=0;i<batch;i++){
   let last=-1,text='',sum=0,count=0;
   for(let step=0;step<steps;step++){const row=i*steps+step,index=indices[row*2];if(index!==0&&index!==last){text+=characters[index];sum+=scores[row*2+1];count++;}last=index;}
   results.push({text:text.trim(),confidence:count?sum/count:0});
  }
  this.downloadBytes+=rows*8;this.fullProbabilityBytes+=rows*classes*4;
  return results;
 }
 dispose(){for(const b of this.buffers.values()){b.out.destroy();b.read.destroy();}this.buffers.clear();}
}
