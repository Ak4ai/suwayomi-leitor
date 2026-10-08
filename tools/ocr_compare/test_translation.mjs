import assert from 'node:assert/strict';
import {translationChunks,translateMyMemory} from '../../public/ocr-web/translation.js';
const encoder=new TextEncoder();
const source=('Olá! Português e inglês. ').repeat(60);
assert.ok(translationChunks(source).every(s=>encoder.encode(s).length<=500));
assert.equal(translationChunks(source).join(' '),source.trim());
assert.throws(()=>translationChunks('a'.repeat(501)));
assert.deepEqual(translationChunks('  '),[]);
const saved=globalThis.fetch;let requests=0;
try{
globalThis.fetch=async(url)=>{requests++;assert.equal(url.searchParams.get('langpair'),'en|pt-BR');return Response.json({responseStatus:200,responseData:{translatedText:'Olá, mundo!'}});};
const segments=[{id:'one',sourceText:'Hello world!'}, {id:'two',sourceText:'Hello world!'}];
assert.equal((await translateMyMemory(segments)).size,2);assert.equal(requests,1);
const corrected={...segments[0],translation:'Olá, pessoal!',translationProvider:'mymemory',translatedSource:segments[0].sourceText};
assert.equal((await translateMyMemory([corrected])).get('one'),'Olá, pessoal!');assert.equal(requests,1);
let completed=0;
globalThis.fetch=async()=>Response.json({responseStatus:429,quotaFinished:true});
await assert.rejects(()=>translateMyMemory([...segments,{id:'three',sourceText:'Another phrase.'}],undefined,()=>{},()=>completed++),/Limite/);assert.equal(completed,2);
const controller=new AbortController();controller.abort();await assert.rejects(()=>translateMyMemory(segments,controller.signal),{name:'AbortError'});
globalThis.fetch=async()=>Response.json({responseStatus:200,responseData:{translatedText:null}});
await assert.rejects(()=>translateMyMemory([{id:'four',sourceText:'Invalid response.'}]),/válida/);
}finally{globalThis.fetch=saved;}
console.log('MyMemory: UTF-8, cache, revisão preservada, cota, progresso parcial, cancelamento e resposta inválida: OK.');
