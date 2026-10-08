// One job at a time, with reading position taking priority over pending work.
export class ChapterQueue {
    constructor(process,onChange=()=>{}){this.process=process;this.onChange=onChange;this.jobs=[];this.current=0;this.ahead=3;this.paused=true;this.generation=0;this.running=false;this.controller=null;}
    setPages(pages){this.pause();this.generation++;this.jobs=pages.map((page,index)=>({...page,index,status:'pending',result:null,error:''}));this.current=0;this.emit();}
    setCurrent(index){this.current=Math.max(0,Math.min(index,this.jobs.length-1));this.emit();void this.pump();}
    setAhead(value){this.ahead=value;this.emit();void this.pump();}
    start({retryFailed=false}={}){if(retryFailed)for(const job of this.jobs)if(job.status==='failed'){job.status='pending';job.error='';}this.paused=false;this.emit();void this.pump();}
    pause(){this.paused=true;this.controller?.abort();this.emit();}
    retry(index,{forceOCR=false,forceTranslate=false}={}){
        const job=this.jobs[index];if(!job)return;
        this.pause();this.current=index;job.status='pending';job.error='';job.forceOCR=forceOCR;job.forceTranslate=forceTranslate||forceOCR;
        if(forceOCR){job.result=null;job.resultRevision=(job.resultRevision||0)+1;}
        this.start();
    }
    emit(){this.onChange(this);}
    next(){
        const end=this.ahead===Infinity?this.jobs.length-1:Math.min(this.jobs.length-1,this.current+this.ahead);
        const order=[this.current,...Array.from({length:Math.max(0,end-this.current)},(_,i)=>this.current+i+1)];
        if(this.ahead===Infinity)for(let i=this.current-1;i>=0;i--)order.push(i);
        return order.map(i=>this.jobs[i]).find(job=>job?.status==='pending');
    }
    async pump(){
        if(this.running||this.paused)return;
        const job=this.next();if(!job)return;
        this.running=true;const generation=this.generation,controller=new AbortController();this.controller=controller;
        const update=patch=>{if(generation===this.generation&&!controller.signal.aborted){if('result' in patch)job.resultRevision=(job.resultRevision||0)+1;Object.assign(job,patch);this.emit();}};
        update({status:'loading',error:''});
        try{
            const result=await this.process(job,controller.signal,update);
            if(generation===this.generation&&!controller.signal.aborted)update({status:'ready',result,forceOCR:false,forceTranslate:false});
        }catch(error){
            if(generation===this.generation){
                if(controller.signal.aborted)job.status='pending';
                else{job.status='failed';job.error=error.message||String(error);if(error.pauseQueue)this.paused=true;}
                this.emit();
            }
        }finally{
            this.running=false;if(this.controller===controller)this.controller=null;
            void this.pump();
        }
    }
}
