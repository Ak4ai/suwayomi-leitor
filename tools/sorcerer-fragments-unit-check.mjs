import assert from 'node:assert/strict';
import {mergeLineFragments} from '../public/ocr-web/vision.js';
const line=box=>({box,score:.9});
const quote=mergeLineFragments([line([68,80,79,92]),line([96,74,493,111]),line([93,108,461,140])]);
assert.equal(quote.length,2);
assert.deepEqual(quote[0].box,[68,74,493,111]);
assert.equal(quote[0].hadFragments,true);
const inside=mergeLineFragments([line([1370,2028,1571,2064]),line([1407,2059,1524,2096]),line([1512,2078,1516,2084])]);
assert.equal(inside.length,2);
assert.equal(inside[1].hadFragments,true);
const separate=mergeLineFragments([line([10,10,20,20]),line([100,100,300,135])]);
assert.equal(separate.length,2);
// Geometry merging never rewrites recognized digits; no text replacement.
const number=mergeLineFragments([{...line([10,10,18,20]),text:'1'},line([30,7,180,37])]);
assert.equal(number.length,1);
console.log(JSON.stringify({passed:true,quoteJoined:true,innerFragmentJoined:true,unrelatedRegionPreserved:true}));
