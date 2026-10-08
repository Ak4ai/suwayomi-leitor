import assert from 'node:assert/strict';
import {selectSegments} from '../public/ocr-web/ocr-quality.js';
const make=(id,text,bubble,confidence=.95)=>({id,sourceText:text,box:[0,0,100,40],bubble:bubble?[0,0,110,50]:null,lines:[{text,box:[0,0,100,40],confidence}],translation:''});
const raw=[make('a','25',false),make('b','s25',false),make('c','25',true),make('d','NO',true),make('e','RANDOM',false,.4),make('f','HELLO WORLD',false),make('g','HELLO WORLD',false)];
const filtered=selectSegments(raw);assert.deepEqual(filtered.segments.map(s=>s.id),['c','d','f']);assert.equal(filtered.ignoredSegments.length,4);assert.equal(raw.length,7);assert.equal(selectSegments(raw,'all',false).segments.length,7);assert.deepEqual(selectSegments(raw,'balloons').segments.map(s=>s.id),['c','d']);
console.log(JSON.stringify({passed:true,preservesSpokenNumbers:true,filtersCodesAndNoise:true,duplicatesRemoved:true,rawPreserved:true}));
