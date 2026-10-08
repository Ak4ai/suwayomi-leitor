import assert from 'node:assert/strict';
import {decodeCTC,suppress,lineComponents} from '../../public/ocr-web/vision.js';
import {translate} from '../../public/ocr-web/translation.js';
assert.equal(decodeCTC(Float32Array.from([0,1,0,0,1,0,1,0,0,0,1,0,0,0,1]),[1,5,3],['','A','B']).text,'AAB');
assert.throws(()=>decodeCTC(new Float32Array(3),[1,1,3],['','A']));
assert.equal(suppress([{box:[0,0,10,10],score:.9},{box:[1,1,10,10],score:.8}]).length,1);
const map=new Float32Array(100*40);for(let y=10;y<20;y++)for(let x=10;x<60;x++)if(x<28||x>35)map[y*100+x]=.9;
assert.equal(lineComponents(map,100,40,100,40).length,1);
const saved=globalThis.fetch;let returned=[{id:'a',translation:'Olá'}];
try{globalThis.fetch=async(url,options)=>{assert.ok(!url.includes('secret'));assert.equal(options.headers['x-goog-api-key'],'secret');const body=JSON.parse(options.body);assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),[{id:'a',text:'Hello'}]);return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({segments:returned})}]}}]}),{status:200});};
assert.equal((await translate([{id:'a',sourceText:'Hello'}],'secret','test-model')).get('a'),'Olá');
returned=[{id:'wrong',translation:'Olá'}];await assert.rejects(()=>translate([{id:'a',sourceText:'Hello'}],'secret','test-model'));
}finally{globalThis.fetch=saved;}
console.log('CTC, agrupamento, NMS e contrato Gemini simulado: OK. Nenhuma chamada externa.');
