import assert from 'node:assert/strict';
import {buildLetteringSVG} from '../public/ocr-web/lettering-svg.js';
import {Lettering,balloonOutline} from '../public/ocr-web/lettering.js';
import {estimateLetteringSurface,recoverLetteringInterior,reconstructLettering} from '../public/ocr-web/lettering-surface.js';

const svg=buildLetteringSVG({width:1200,height:1752,rasterWidth:1200,rasterHeight:1752,background:'data:image/png;base64,AA==',fontCSS:'',textLayers:[{id:'s1',style:{family:'comic',weight:'900',slant:'normal'},size:18,stroke:.8,ink:'#111',lines:[{x:100,y:200,text:'Olá <texto> & "aspas"\u0000'}]}]});
assert.ok(svg.includes('width="1200" height="1752" viewBox="0 0 1200 1752" text-rendering="geometricPrecision"'));
assert.ok(svg.includes('Olá &lt;texto&gt; &amp; &quot;aspas&quot;'));
assert.ok(!svg.includes('\u0000')&&!svg.includes('<texto>'));
assert.equal((svg.match(/<text /g)||[]).length,1);
assert.ok(svg.includes('stroke-width="0.27"'));
// Outlined glyphs: one <path> per line, Canvas reinforcement, text in <title>.
const outlined=buildLetteringSVG({width:10,height:10,rasterWidth:10,rasterHeight:10,background:'data:image/png;base64,AA==',fontCSS:'',textLayers:[{id:'s2',style:{family:'comic',weight:'900',slant:'normal'},size:20,stroke:.9,ink:'#fff',lines:[{x:5,y:5,text:'A & B'}],paths:['M0 0L1 1Z']}]});
assert.ok(outlined.includes('<title>A &amp; B</title><path d="M0 0L1 1Z"/>'));
assert.ok(outlined.includes('stroke="#fff" stroke-width="0.9"'));
assert.ok(!outlined.includes('<text')&&!outlined.includes('<style>'));
// Light variant: glyphs defined once, placed with <use>, stroke in font units.
const light=buildLetteringSVG({width:10,height:10,rasterWidth:10,rasterHeight:10,background:'data:image/jpeg;base64,AA==',fontCSS:'',glyphs:new Map([['f:1',{id:'g0',d:'M0 0L9 9Z'}]]),textLayers:[{id:'s3',style:{family:'comic',weight:'900',slant:'normal'},size:20,stroke:.9,ink:'#111',lines:[{x:5,y:6,text:'AA'}],glyphLines:[{x:5,y:6,scale:.02,uses:[['g0',-500],['g0',0]]}]}]});
assert.ok(light.includes('<defs><path id="g0" d="M0 0L9 9Z"/></defs>'));
assert.ok(light.includes('<g transform="translate(5 6) scale(0.02)"><use href="#g0" x="-500"/><use href="#g0" x="0"/></g>'));
assert.ok(light.includes('stroke-width="45"')&&light.includes('<title>AA</title>'));
assert.ok(!light.includes('<text')&&!light.includes('<style>'));
assert.ok(svg.includes('stroke-linejoin="round"'));
assert.ok(svg.includes('font-weight="700"'));

const width=48,height=48,pixels=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,t=((x*13+y*7)%101)/125;pixels[i]=250+5*t;pixels[i+1]=200+55*t;pixels[i+2]=50+205*t;pixels[i+3]=255;}
const paper=estimateLetteringSurface(pixels,width,height,[5,5,43,43]);
assert.ok(!paper.reason&&paper.textured);
assert.equal(paper.ink,'#111');
const mask=recoverLetteringInterior(9,9,[0,0,9,9],[1,1,8,8],i=>{const x=i%9,y=Math.floor(i/9);return x>=1&&x<=7&&y>=1&&y<=7&&!(x===4&&y===4)&&!(x>=6&&y<=3);});
assert.equal(mask[4*9+4],1); // enclosed glyph hole
assert.equal(mask[2*9+7],0); // concave corner connected to outside

const source=new Uint8ClampedArray(16*16*4),interior=new Uint8Array(256),allowed=new Uint8Array(256).fill(1);
for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=y*16+x;source.set([240,240,240,255],i*4);if(x>=2&&x<14&&y>=2&&y<14)interior[i]=1;}
for(const i of [8*16+8,8*16+2])source.set([0,0,0,255],i*4);
const savedSource=new Uint8ClampedArray(source);
const reconstructed=reconstructLettering(source,16,16,new Uint8Array(256),interior,allowed,{ink:'#111',at:()=>[240,240,240],distance:i=>240-source[i*4]},{lineHeight:16});
assert.equal(reconstructed.mask[8*16+8],1);
assert.equal(reconstructed.mask[8*16+2],0);
assert.equal(reconstructed.pixels[(8*16+8)*4],240);
assert.equal(reconstructed.pixels[(8*16+2)*4+3],0);
assert.deepEqual(source,savedSource);
assert.ok(reconstructed.quality.recoveredPixels>0);

// Synthetic font metrics isolate layout logic; this is not visual validation.
const ctx={font:'',measureText(text){const size=Number(this.font.match(/([\d.]+)px/)[1]);return{width:text.length*size*.5,actualBoundingBoxLeft:text.length*size*.25,actualBoundingBoxRight:text.length*size*.25,actualBoundingBoxAscent:size*.7,actualBoundingBoxDescent:size*.15};}};
const region={x:0,y:0,w:100,h:100,sourceHeight:16,textArea:{x:10,y:5,w:80,h:20},spans:Array.from({length:100},(_,y)=>y>=35&&y<=80?{left:4,right:96}:null)};
const layout=Lettering.prototype.layout.call({image:{width:500}},ctx,'Texto completo',region,1,{family:'comic',weight:'900',slant:'normal'});
assert.ok(layout);
assert.equal(layout.lines.map(line=>line.text).join(' '),'Texto completo');
for(const line of layout.lines)assert.ok(line.y>=35&&line.y<=81);
// Balloon outline: smoothed spans (one jagged row ignored), closed shape around the interior.
const spans=Array.from({length:60},(_,row)=>row===30?{left:48,right:52}:{left:20-Math.round(10*Math.sin(row/60*Math.PI)),right:80+Math.round(10*Math.sin(row/60*Math.PI))});
const ring=balloonOutline({x:0,y:100,spans});
assert.ok(ring.length>=40&&ring.length<=64);
assert.ok(ring[0][1]===100&&ring[0][0]>=18&&ring[0][0]<=20);
assert.ok(ring.every(([x])=>x<=21||x>=79));
assert.equal(Math.max(...ring.map(([,y])=>y)),160);
assert.ok(balloonOutline({spans:[],textArea:{x:1,y:2,w:3,h:4}}).length===4);
console.log(JSON.stringify({passed:true,svgEscaping:true,rasterDimensions:true,lightGlyphs:true,balloonOutline:true,tonalYellow:true,concavityPreserved:true,enclosedHoleFilled:true,shiftedLayout:true,unmaskedInkRecovered:true,borderProtected:true,sourceUnchanged:true}));
