// Error rates use visually transcribed reference text, not another OCR's output.
function normalize(text){return text.normalize('NFC').replace(/[\u2018\u2019]/g,"'").replace(/\u2026/g,'...').replace(/\s+/g,' ').trim().toUpperCase();}
function editDistance(a,b){
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)));row=next;}
 return row[b.length];
}
function score(entries,texts,contentOnly=false){
 const byId=new Map(texts.map(t=>[t.id,t.text]));let characters=0,characterErrors=0,words=0,wordErrors=0,exact=0;const errors=[];
 for(const entry of entries.filter(e=>e.score)){
  const transform=text=>contentOnly?normalize(text).replace(/[^\p{L}\p{N}\s]/gu,'').replace(/\s+/g,' ').trim():normalize(text);
  const reference=transform(entry.expected),actual=transform(byId.get(entry.id)||''),ce=editDistance([...reference],[...actual]),we=editDistance(reference.split(' '),actual?actual.split(' '):[]);
  characters+=[...reference].length;characterErrors+=ce;words+=reference.split(' ').length;wordErrors+=we;if(reference===actual)exact++;
  if(reference!==actual)errors.push({id:entry.id,expected:entry.expected,actual:byId.get(entry.id)||'',characterErrors:ce,wordErrors:we,category:entry.category});
 }
 return {lines:entries.filter(e=>e.score).length,exactLines:exact,characters,characterErrors,cer:characterErrors/characters,words,wordErrors,wer:wordErrors/words,errors};
}
module.exports={normalize,editDistance,score};
