import assert from 'node:assert/strict';
import {ChapterQueue} from '../public/ocr-web/chapter-queue.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const order=[],pending=[];let active=0,maxActive=0;
const queue=new ChapterQueue((job,signal)=>new Promise((resolve,reject)=>{
    active++;maxActive=Math.max(maxActive,active);order.push(job.index);
    const abort=()=>{active--;reject(new DOMException('aborted','AbortError'));};signal.addEventListener('abort',abort,{once:true});
    pending.push(()=>{signal.removeEventListener('abort',abort);active--;resolve({index:job.index});});
}));
queue.setPages(Array.from({length:8},(_,id)=>({id})));queue.setAhead(2);queue.start();
assert.deepEqual(order,[0]);queue.setCurrent(5);pending.shift()();await tick();assert.deepEqual(order,[0,5]);
pending.shift()();await tick();assert.deepEqual(order,[0,5,6]);pending.shift()();await tick();pending.shift()();await tick();
assert.deepEqual(order,[0,5,6,7]);assert.equal(maxActive,1);
queue.setCurrent(2);assert.equal(order.at(-1),2);queue.pause();await tick();assert.equal(queue.jobs[2].status,'pending');
pending.length=0;queue.start();assert.equal(order.at(-1),2);pending.shift()();await tick();queue.pause();await tick();
pending.length=0;queue.setPages([{id:'new'}]);queue.start();pending.shift()();await tick();assert.equal(queue.jobs[0].status,'ready');queue.pause();
let count=0;const quota=new ChapterQueue(async()=>{count++;const error=new Error('quota');error.pauseQueue=true;throw error;});quota.setPages([{id:0},{id:1}]);quota.start();await tick();assert.equal(quota.paused,true);assert.equal(count,1);assert.equal(quota.jobs[0].status,'failed');
console.log(JSON.stringify({passed:true,maxActive,priorityOrder:order,quotaPaused:true}));
