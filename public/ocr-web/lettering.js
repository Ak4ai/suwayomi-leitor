import {estimateLetteringSurface,recoverLetteringInterior,reconstructLettering} from './lettering-surface.js';
// Local cleanup for uniform colours and smooth gradients, in either polarity.
// No neural inpainting: uncertain regions retain their original pixels.
export async function loadLetteringFonts(){
    const faces=[['Comic Neue Local','ComicNeue-Regular.ttf','400','normal'],['Comic Neue Local','ComicNeue-Bold.ttf','700','normal'],['Comic Neue Local','ComicNeue-Italic.ttf','400','italic'],['Comic Neue Local','ComicNeue-BoldItalic.ttf','700','italic'],['Bangers Local','Bangers-Regular.ttf','400','normal']];
    await Promise.all(faces.map(async([family,file,weight,style])=>{const font=await new FontFace(family,`url(${new URL(file,import.meta.url).href})`,{weight,style}).load();document.fonts.add(font);}));
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;};
export function suggestLettering(glyphs){
    // Geometric cues only. Handwriting, curved letters and joined characters
    // make these approximate style hints, not font identification.
    if(glyphs.length<4)return {family:'comic',weight:'900',slant:'normal',reliable:false,glyphs:glyphs.length};
    const thickness=median(glyphs.map(g=>g.thickness)),aspect=median(glyphs.map(g=>g.aspect)),lean=median(glyphs.map(g=>g.lean));
    return {family:aspect<.40?'bangers':'comic',weight:thickness>=.12?'900':'700',slant:lean>.12?'italic':'normal',reliable:true,glyphs:glyphs.length,thickness,aspect,lean};
}
export function resolveLettering(suggestion,override={}){
    const source=suggestion||suggestLettering([]);
    const family=['comic','bangers'].includes(override.family)?override.family:source.family;
    const weight=['400','700','900'].includes(override.weight)?override.weight:source.weight;
    const slant=['normal','italic'].includes(override.slant)?override.slant:source.slant;
    return {family,weight,slant};
}
function fontSpec(style,size){return `${style.slant} ${style.family==='bangers'?'400':style.weight==='900'?'700':style.weight} ${size}px "${style.family==='bangers'?'Bangers Local':'Comic Neue Local'}"`;}
export function styleLabel(style){return `${style.family==='bangers'?'Bangers (estreita)':'Comic Neue'} · ${style.family==='bangers'?'traço forte':style.weight==='900'?'negrito reforçado':style.weight==='700'?'negrito':'regular'} · ${style.slant==='italic'?'itálico':'normal'}`;}
export class Lettering {
    constructor(){this.image=null;this.cache=new WeakMap();this.source=document.createElement('canvas');}
    prepare(image){if(this.image===image)return;this.image=image;this.cache=new WeakMap();this.source.width=image.width;this.source.height=image.height;this.source.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0);}
    region(segment){
        if(this.cache.has(segment))return this.cache.get(segment);
        const finish=value=>{this.cache.set(segment,value);return value;};
        if(!segment.lines?.length)return finish({reason:'Sem linhas confiáveis para limpar o texto'});
        const [tx,ty,tx2,ty2]=segment.box.map(Math.round);
        const inferred=!segment.bubble;
        const estimatedHeight=median(segment.lines.map(line=>line.box[3]-line.box[1]));
        const padding=Math.max(2,estimatedHeight*.35);
        const [bx,by,bx2,by2]=segment.bubble||[tx-padding,ty-padding,tx2+padding,ty2+padding];
        const x=Math.max(0,Math.floor(Math.min(bx,tx)-4)),y=Math.max(0,Math.floor(Math.min(by,ty)-4));
        const x2=Math.min(this.image.width,Math.ceil(Math.max(bx2,tx2)+4)),y2=Math.min(this.image.height,Math.ceil(Math.max(by2,ty2)+4)),w=x2-x,h=y2-y;
        if(w<12||h<12||w*h>1500000)return finish({reason:'Região inadequada para limpeza leve'});
        const pixels=this.source.getContext('2d').getImageData(x,y,w,h),d=pixels.data;
        const localText=[tx-x,ty-y,tx2-x,ty2-y];
        const surface=estimateLetteringSurface(d,w,h,localText,{inferred});
        if(surface.reason)return finish({reason:surface.reason});
        const bg=surface.centre,distance=p=>surface.distance(p/4);
        const interior=recoverLetteringInterior(w,h,[bx-x,by-y,bx2-x,by2-y],localText,i=>surface.distance(i)<=30,{bridgeRadius:inferred?0:Math.max(1,Math.min(5,Math.ceil(estimatedHeight*.14)))});
        const allowed=new Uint8Array(w*h),mask=new Uint8Array(w*h);
        for(const line of segment.lines){const b=line.box;for(let yy=Math.max(0,Math.floor(b[1]-y));yy<Math.min(h,Math.ceil(b[3]-y));yy++)for(let xx=Math.max(0,Math.floor(b[0]-x));xx<Math.min(w,Math.ceil(b[2]-x));xx++)allowed[yy*w+xx]=1;}
        // Include punctuation omitted by line OCR, but still inside the text
        // detector's box. Large/edge-connected components stay protected below.
        const supportPadding=Math.max(1,Math.min(4,Math.round(median(segment.lines.map(l=>l.box[3]-l.box[1]))*.2)));
        for(let yy=Math.max(0,ty-y-supportPadding);yy<Math.min(h,ty2-y+supportPadding);yy++)for(let xx=Math.max(0,tx-x-supportPadding);xx<Math.min(w,tx2-x+supportPadding);xx++)allowed[yy*w+xx]=1;
        const visited=new Uint8Array(w*h),protectedInk=new Uint8Array(w*h),queue=new Int32Array(w*h);
        const lineHeights=segment.lines.map(l=>l.box[3]-l.box[1]).sort((a,b)=>a-b),lineHeight=lineHeights[Math.floor(lineHeights.length/2)];
        let marked=0;const glyphs=[],rejected=[];
        for(let seed=0;seed<w*h;seed++){
            // Keep full ink components for contour protection.
            if(visited[seed]||distance(seed*4,bg)<=30)continue;
            let head=0,tail=1,left=w,right=0,top=h,bottom=0,supported=0,colored=0;queue[0]=seed;visited[seed]=1;
            while(head<tail){const i=queue[head++],xx=i%w,yy=Math.floor(i/w);left=Math.min(left,xx);right=Math.max(right,xx);top=Math.min(top,yy);bottom=Math.max(bottom,yy);supported+=allowed[i];if(Math.max(d[i*4],d[i*4+1],d[i*4+2])-Math.min(d[i*4],d[i*4+1],d[i*4+2])>65)colored++;
                for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=xx+dx,ny=yy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const n=ny*w+nx;if(!visited[n]&&distance(n*4,bg)>30){visited[n]=1;queue[tail++]=n;}}
            }
            const localHeight=Math.max(lineHeight,...segment.lines.filter(l=>l.box[1]<=y+bottom&&l.box[3]>=y+top).map(l=>l.box[3]-l.box[1]));
            const isLetter=tail>=2&&supported/tail>.7&&left>1&&top>1&&right<w-2&&bottom<h-2&&bottom-top<localHeight*1.5&&right-left<w*.8;
            const gh=bottom-top+1,gw=right-left+1;
            if(!isLetter&&supported)rejected.push({box:[x+left,y+top,x+right,y+bottom],support:supported/tail,height:gh,localHeight,width:gw,crop:[x,y,w,h]});
            if(isLetter&&gh>=lineHeight*.45&&gw/gh>.15&&gw/gh<1.5){
                let perimeter=0,upper=0,lower=0,upperCount=0,lowerCount=0;
                for(let k=0;k<tail;k++){const i=queue[k],xx=i%w,yy=Math.floor(i/w);
                    for(const n of [i-1,i+1,i-w,i+w])if(n<0||n>=w*h||distance(n*4,bg)<=30)perimeter++;
                    if(yy<top+gh*.35){upper+=xx;upperCount++;}if(yy>top+gh*.65){lower+=xx;lowerCount++;}
                }
                glyphs.push({height:gh,thickness:2*tail/Math.max(1,perimeter)/gh,aspect:gw/gh,lean:upperCount&&lowerCount?(upper/upperCount-lower/lowerCount)/(gh*.65):0});
            }
            for(let k=0;k<tail;k++){if(isLetter){mask[queue[k]]=1;marked++;}else protectedInk[queue[k]]=1;}
        }
        // Recover text strokes attached to a preserved contour, only inside
        // OCR line boxes and an inset of the detected balloon. Never erase the
        // complete component: it also contains the balloon border.
        const inset=Math.max(2,Math.min(bx2-bx,by2-by)*.045);
        const hasPaperAlong=(i,dx,dy)=>{
            const xx=i%w,yy=Math.floor(i/w),reach=Math.max(2,Math.ceil(lineHeight*.45));
            for(let step=1;step<=reach;step++){const nx=xx+dx*step,ny=yy+dy*step;if(nx<0||nx>=w||ny<0||ny>=h)return false;const n=ny*w+nx;if(interior[n]&&surface.distance(n)<=30)return true;}return false;
        };
        const surrounded=i=>(hasPaperAlong(i,-1,0)&&hasPaperAlong(i,1,0))||(hasPaperAlong(i,0,-1)&&hasPaperAlong(i,0,1));
        for(const line of segment.lines){
            const b=line.box;
            for(let yy=Math.max(0,Math.ceil(Math.max(b[1],by+inset)-y));yy<Math.min(h,Math.floor(Math.min(b[3],by2-inset)-y));yy++)
                for(let xx=Math.max(0,Math.ceil(Math.max(b[0],bx+inset)-x));xx<Math.min(w,Math.floor(Math.min(b[2],bx2-inset)-x));xx++){
                    const i=yy*w+xx;
                    if(protectedInk[i]&&distance(i*4,bg)>30&&(interior[i]||surrounded(i))){mask[i]=1;interior[i]=1;protectedInk[i]=0;marked++;}
                }
        }
        if(marked<5)return finish({reason:'Máscara de letras incerta'});
        let expanded=new Uint8Array(mask);
        const radius=surface.textured?Math.max(2,Math.min(8,Math.ceil(lineHeight*.15))):2;
        for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(mask[yy*w+xx])for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const nx=xx+dx,ny=yy+dy;if(nx<0||nx>=w||ny<0||ny>=h||dx*dx+dy*dy>radius*radius)continue;const n=ny*w+nx;if(!protectedInk[n]&&interior[n])expanded[n]=1;}
        for(let i=0;i<expanded.length;i++)if(!interior[i])expanded[i]=0;
        const reconstruction=reconstructLettering(d,w,h,expanded,interior,allowed,surface,{lineHeight});
        expanded=reconstruction.mask;
        const cleanedPixels=expanded.reduce((sum,value)=>sum+value,0);
        if(cleanedPixels<5||cleanedPixels/(w*h)>(surface.textured ? .75 : .45))return finish({reason:'Máscara sem espaço seguro dentro do balão'});
        const maskCanvas=document.createElement('canvas');maskCanvas.width=w;maskCanvas.height=h;const debug=maskCanvas.getContext('2d').createImageData(w,h);
        for(let i=0;i<expanded.length;i++)if(expanded[i]){debug.data[i*4]=255;debug.data[i*4+3]=160;}
        maskCanvas.getContext('2d').putImageData(debug,0,0);
        // Only masked pixels are composited. Copying a whole crop would restore
        // English over translations in neighboring, overlapping balloon boxes.
        d.set(reconstruction.pixels);
        const clean=document.createElement('canvas');clean.width=w;clean.height=h;clean.getContext('2d').putImageData(pixels,0,0);
        // Clear spans around the text center, bounded by preserved ink/art.
        // Each rendered line must fit its complete height inside these spans.
        const center=Math.round((tx+tx2)/2-x),spans=[];
        const paper=i=>interior[i]&&(expanded[i]||surface.distance(i)<=30);
        for(let yy=0;yy<h;yy++){
            let best=null,start=-1;
            for(let xx=0;xx<=w;xx++){
                if(xx<w&&paper(yy*w+xx)){if(start<0)start=xx;continue;}
                if(start>=0){const end=xx-1,length=end-start+1,score=length-Math.abs((start+end)/2-center)*.35;if(!best||score>best.score)best={left:x+start,right:x+end,score};start=-1;}
            }
            spans.push(best);
        }
        return finish({x,y,w,h,clean,mask:maskCanvas,spans,rejected,quality:reconstruction.quality,ink:surface.ink,cleanup:surface.textured?'local-colour':surface.gradient?'smooth-gradient':'flat-colour',inferredBackground:inferred,sourceHeight:median(glyphs.map(g=>g.height).filter(Boolean))||lineHeight*.8,suggestion:suggestLettering(glyphs),textArea:{x:tx,y:ty,w:tx2-tx,h:ty2-ty}});
    }
    layout(ctx,text,region,scale,style){
        const words=text.trim().split(/\s+/),area=region.textArea;
        // Canvas pixels are source-image pixels, not screen pixels. Scale the
        // font floor and spacing with the source lettering and balloon size.
        const unit=Math.max(.25,Math.min(2,region.sourceHeight/16));
        const centerY=area.y+area.h/2,margin=Math.max(unit*2,region.w*.035);
        const max=Math.min(100,Math.ceil(region.sourceHeight*1.7*scale));
        ctx.textAlign='center';ctx.textBaseline='alphabetic';
        const minimum=Math.max(3,Math.min(12,Math.floor(region.sourceHeight*.55)));
        for(let size=max;size>=minimum;size--){
            ctx.font=fontSpec(style,size);
            const stroke=style.family==='comic'&&style.weight==='900'?size*.045:0;
            const metric=ctx.measureText(text),ascent=metric.actualBoundingBoxAscent,descent=metric.actualBoundingBoxDescent;
            const inkHeight=ascent+descent,step=inkHeight+Math.max(unit*1.5,size*.18)+stroke;
            const width=line=>{const m=ctx.measureText(line);return Math.max(m.width,2*m.actualBoundingBoxLeft,2*m.actualBoundingBoxRight)+stroke;};
            for(let count=1;count<=Math.min(words.length,14);count++){
                const centres=[centerY,region.y+region.h/2,centerY-region.h*.08,centerY+region.h*.08,centerY-region.h*.16,centerY+region.h*.16];
                for(const candidateY of [...new Set(centres)]){
                const top=candidateY-(inkHeight+(count-1)*step)/2,rows=[];
                for(let row=0;row<count;row++){
                    const baseline=top+row*step+ascent;
                    let left=-Infinity,right=Infinity;
                    const padding=Math.max(1,Math.round(unit));
                    for(let yy=Math.floor(baseline-ascent-stroke/2)-padding;yy<=Math.ceil(baseline+descent+stroke/2)+padding;yy++){
                        const span=region.spans[yy-region.y];if(!span){left=Infinity;break;}
                        left=Math.max(left,span.left+margin);right=Math.min(right,span.right-margin);
                    }
                    if(right<=left){rows.length=0;break;}
                    rows.push({x:(left+right)/2,y:baseline,width:right-left});
                }
                if(rows.length!==count)continue;
                // Balance line lengths while allowing wider middle rows of an oval.
                const memo=new Map();
                const wrap=(row,start)=>{
                    if(row===count)return start===words.length?{cost:0,lines:[]}:null;
                    const key=`${row}:${start}`;if(memo.has(key))return memo.get(key);
                    let best=null,line='';
                    for(let end=start;end<words.length-(count-row-1);end++){
                        line+=`${end===start?'':' '}${words[end]}`;const used=width(line);if(used>rows[row].width)break;
                        const tail=wrap(row+1,end+1);if(!tail)continue;
                        const cost=tail.cost+(1-used/rows[row].width)**2;
                        if(!best||cost<best.cost)best={cost,lines:[{...rows[row],text:line},...tail.lines]};
                    }
                    memo.set(key,best);return best;
                };
                const result=wrap(0,0);if(result)return {lines:result.lines,size,stroke};
                }
            }
        }
        return null;
    }
    paint(canvas,image,segments,{translated,fontReady,scale=1,vectorText=false,background,skipCleanup=false,regionOverrides}){
        this.prepare(image);const ctx=canvas.getContext('2d');canvas.width=image.width;canvas.height=image.height;ctx.drawImage(background||image,0,0,canvas.width,canvas.height);
        const notes=new Map(),textLayers=[],cleanupQuality=new Map();let applied=0;
        for(const s of segments){
            if(!translated||!s.translation.trim())continue;
            if(s.sourceText.replace(/\s+/g,' ').trim().toLowerCase()===s.translation.replace(/\s+/g,' ').trim().toLowerCase()){notes.set(s.id,'Tradução igual ao original; região preservada');continue;}
            if(!fontReady){notes.set(s.id,'Aguardando a fonte; tradução no painel');continue;}
            const region=regionOverrides?.get(s.id)||this.region(s);
            if(region.quality)cleanupQuality.set(s.id,region.quality);
            if(region.reason){notes.set(s.id,`${region.reason}; tradução no painel`);continue;}
            const style=resolveLettering(region.suggestion,s.letteringStyle);
            const layout=this.layout(ctx,s.translation,region,scale,style);
            if(!layout){notes.set(s.id,'Texto não cabe com tamanho legível; tradução no painel');continue;}
            if(!skipCleanup)ctx.drawImage(region.clean,region.x,region.y);ctx.font=fontSpec(style,layout.size);ctx.fillStyle=region.ink;ctx.strokeStyle=region.ink;ctx.lineWidth=layout.stroke;ctx.lineJoin='round';ctx.textAlign='center';ctx.textBaseline='alphabetic';
            textLayers.push({id:s.id,style,size:layout.size,stroke:layout.stroke,ink:region.ink,lines:layout.lines});
            if(!vectorText)layout.lines.forEach(line=>{if(layout.stroke)ctx.strokeText(line.text,line.x,line.y);ctx.fillText(line.text,line.x,line.y);});
            applied++;notes.set(s.id,`Tradução aplicada · ${styleLabel(style)}`);
        }
        return {notes,applied,textLayers,cleanupQuality};
    }
}

// Automatic render-only scaling. OCR coordinates remain in source pixels.
export function renderScale(width,height){
    // Target enough raster pixels for lettering, with a memory ceiling for
    // long pages. Original images above the ceiling are never enlarged.
    if(width<=0||height<=0)return 1;
    const desired=Math.max(1,1200/Math.min(width,height));
    const memoryLimit=Math.sqrt(12000000/(width*height));
    return Math.max(1,Math.min(3,desired,memoryLimit));
}
export class ReadableLettering {
    constructor(){this.lettering=new Lettering();this.image=null;this.raster=null;this.scaled=new WeakMap();this.factor=1;}
    paint(canvas,image,segments,options){
        const factor=renderScale(image.width,image.height);
        if(this.image!==image||this.factor!==factor){
            this.image=image;this.factor=factor;this.scaled=new WeakMap();
            if(this.factor>1){this.raster=document.createElement('canvas');this.raster.width=Math.floor(image.width*this.factor);this.raster.height=Math.floor(image.height*this.factor);const ctx=this.raster.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0,this.raster.width,this.raster.height);}else this.raster=image;
        }
        const mapped=segments.map(segment=>{
            let target=this.scaled.get(segment);
            if(!target){const box=values=>values?.map(v=>v*this.factor)||null;target={...segment,box:box(segment.box),bubble:box(segment.bubble),lines:segment.lines?.map(line=>({...line,box:box(line.box)}))||[]};this.scaled.set(segment,target);}
            target.translation=segment.translation;target.sourceText=segment.sourceText;target.letteringStyle=segment.letteringStyle;return target;
        });
        let regionOverrides=options.regionOverrides;
        if(regionOverrides&&this.factor!==1){const factor=this.factor;regionOverrides=new Map([...regionOverrides].map(([id,r])=>[id,{...r,x:Math.floor(r.x*factor),y:Math.floor(r.y*factor),w:Math.ceil(r.w*factor),h:Math.ceil(r.h*factor),sourceHeight:r.sourceHeight*factor,textArea:Object.fromEntries(Object.entries(r.textArea).map(([key,value])=>[key,value*factor])),spans:Array.from({length:Math.ceil(r.h*factor)},(_,row)=>{const span=r.spans[Math.min(r.spans.length-1,Math.floor(row/factor))];return span?{left:span.left*factor,right:span.right*factor}:null;})}]));}
        return this.lettering.paint(canvas,this.raster,mapped,{...options,regionOverrides});
    }
}
