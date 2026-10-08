import assert from 'node:assert/strict';
import {pickMemoryTranslation,suspiciouslyShort,translationRequest} from '../public/ocr-web/translation-quality.js';
const source="I DON'T KNOW. I'M...JUST ONE PERSON. I DON'T KNOW HOW TO FIX THE WORLD.";
assert.throws(()=>pickMemoryTranslation({responseData:{translatedText:'Não sei como.',match:.44},matches:[{segment:"I don't know how to.",translation:'Não sei como.',match:.44}]},source),e=>e.code==='INCOMPLETE_TRANSLATION');
assert.throws(()=>pickMemoryTranslation({responseData:{translatedText:'Não sei como.',match:1}},source),e=>e.code==='INCOMPLETE_TRANSLATION');
assert.equal(pickMemoryTranslation({matches:[{segment:"I don't know.",translation:'Não sei.',match:.98}]} ,"I DON'T KNOW."),'Não sei.');
assert.equal(suspiciouslyShort(source,'Não sei como.'),true);
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError')),{once:true}));
 await assert.rejects(translationRequest('https://example.invalid',undefined,30),e=>e.code==='TRANSLATION_TIMEOUT');
 const controller=new AbortController(),pending=translationRequest('https://example.invalid',controller.signal,1000);controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({passed:true,partialMatchRejected:true,shortReplyRejected:true,completeReplyAccepted:true,timeoutWorks:true,cancellationWorks:true}));
