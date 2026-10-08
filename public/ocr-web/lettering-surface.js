// Local colour/geometry analysis only; no additional model or network request.
const colourDistance=(a,b)=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]));
function solve(matrix,values){
    const size=matrix.length;
    const rows=matrix.map((row,i)=>[...row,values[i]]);
    for(let col=0;col<size;col++){
        let pivot=col;for(let i=col+1;i<size;i++)if(Math.abs(rows[i][col])>Math.abs(rows[pivot][col]))pivot=i;
        [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
        if(Math.abs(rows[col][col])<1e-7)return null;
        const divisor=rows[col][col];for(let j=col;j<=size;j++)rows[col][j]/=divisor;
        for(let i=0;i<size;i++)if(i!==col){const factor=rows[i][col];for(let j=col;j<=size;j++)rows[i][j]-=factor*rows[col][j];}
    }
    return rows.map(row=>row[size]);
}
function fitRadial(samples){
    const matrix=Array.from({length:6},()=>Array(6).fill(0)),values=Array.from({length:3},()=>Array(6).fill(0));
    for(const s of samples){const v=[1,s.u,s.v,s.u*s.u,s.u*s.v,s.v*s.v];for(let i=0;i<6;i++){for(let j=0;j<6;j++)matrix[i][j]+=v[i]*v[j];for(let c=0;c<3;c++)values[c][i]+=v[i]*s.rgb[c];}}
    const result=values.map(channel=>solve(matrix,channel));return result.every(Boolean)?result:null;
}
function fit(samples){
    const matrix=Array.from({length:3},()=>[0,0,0]),values=Array.from({length:3},()=>[0,0,0]);
    for(const s of samples){const v=[1,s.u,s.v];for(let i=0;i<3;i++){for(let j=0;j<3;j++)matrix[i][j]+=v[i]*v[j];for(let c=0;c<3;c++)values[c][i]+=v[i]*s.rgb[c];}}
    return values.map(channel=>solve(matrix,channel)||[channel[0]/Math.max(1,samples.length),0,0]);
}
const predict=(plane,u,v)=>plane.map(c=>Math.max(0,Math.min(255,c[0]+c[1]*u+c[2]*v)));
export function estimateLetteringSurface(data,width,height,textArea,{inferred=false}={}){
    const [x1,y1,x2,y2]=textArea.map((v,i)=>Math.max(0,Math.min(i%2?height:width,Math.round(v))));
    if(x2<=x1||y2<=y1)return {reason:'Área de texto inválida'};
    const step=Math.max(1,Math.ceil(Math.sqrt((x2-x1)*(y2-y1)/20000))),samples=[],bins=new Map();
    for(let y=y1;y<y2;y+=step)for(let x=x1;x<x2;x+=step){
        const p=(y*width+x)*4,rgb=[data[p],data[p+1],data[p+2]],u=(x-(x1+x2)/2)/Math.max(1,(x2-x1)/2),v=(y-(y1+y2)/2)/Math.max(1,(y2-y1)/2);
        const sample={rgb,u,v,quadrant:(u>=0?1:0)+(v>=0?2:0)};samples.push(sample);
        const key=`${rgb[0]>>5},${rgb[1]>>5},${rgb[2]>>5}`,bin=bins.get(key)||[];bin.push(sample);bins.set(key,bin);
    }
    if(samples.length<16)return {reason:'Poucos pixels para estimar o fundo'};
    let best=null;const diagnostics=[];
    for(const seed of [...bins.values()].sort((a,b)=>b.length-a.length).slice(0,6)){
        const mean=[0,1,2].map(c=>seed.reduce((sum,s)=>sum+s.rgb[c],0)/seed.length);
        let selected=samples.filter(s=>colourDistance(s.rgb,mean)<44),plane;
        for(let iteration=0;iteration<3;iteration++){
            if(selected.length<12)break;plane=fit(selected);
            selected=samples.filter(s=>colourDistance(s.rgb,predict(plane,s.u,s.v))<=26);
        }
        if(!plane||selected.length<12)continue;
        const coverage=selected.length/samples.length,counts=[0,0,0,0],totals=[0,0,0,0];
        for(const s of samples)totals[s.quadrant]++;for(const s of selected)counts[s.quadrant]++;
        // Background must exist throughout the text area, not only in one
        // flat patch of surrounding artwork or in the strokes of one letter.
        const distributed=counts.every((count,i)=>!totals[i]||count/totals[i]>=(inferred ? .4 : .25));
        const variation=Math.max(...plane.map(c=>Math.abs(c[1])+Math.abs(c[2])));
        diagnostics.push({coverage,variation,quadrants:counts.map((count,i)=>count/Math.max(1,totals[i])),mean});
        if(!distributed||variation>130||coverage<(inferred ? .6 : .45))continue;
        if(!best||coverage>best.coverage)best={plane,coverage,variation};
    }
    if(!best){
        // Printed coloured paper can vary towards white at almost every pixel.
        // A spatial plane cannot explain this tonal variation. Recognize a
        // narrow colour family while keeping black/white lettering excluded.
        let family=null;
        for(const seed of [...bins.values()].sort((a,b)=>b.length-a.length).slice(0,6)){
            const base=[0,1,2].map(c=>seed.reduce((sum,s)=>sum+s.rgb[c],0)/seed.length);
            if(Math.max(...base)-Math.min(...base)<40)continue;
            const axis=base.map(value=>255-value),length=axis.reduce((sum,value)=>sum+value*value,0);
            const lightPaper=.2126*base[0]+.7152*base[1]+.0722*base[2]>150;
            const strongest=base.indexOf(Math.max(...base));
            const residual=(red,green,blue)=>{
                // Faint dark antialiasing is still ink, not a pale highlight.
                // The strongest colour channel stays high on the paper even
                // when its saturation varies towards white.
                const amount=((red-base[0])*axis[0]+(green-base[1])*axis[1]+(blue-base[2])*axis[2])/Math.max(1,length);
                // White highlights are paper on light coloured balloons;
                // on dark balloons they can be white lettering instead.
                if(amount<-.25||amount>(lightPaper?1.1:.85))return 100;
                return Math.max(Math.abs(red-base[0]-amount*axis[0]),Math.abs(green-base[1]-amount*axis[1]),Math.abs(blue-base[2]-amount*axis[2]));
            };
            const selected=samples.filter(s=>residual(...s.rgb)<=28),counts=[0,0,0,0],totals=[0,0,0,0];
            for(const s of samples)totals[s.quadrant]++;for(const s of selected)counts[s.quadrant]++;
            const coverage=selected.length/samples.length;
            if(coverage<(inferred ? .72 : .6)||!counts.every((count,i)=>!totals[i]||count/totals[i]>=.45))continue;
            if(!family||coverage>family.coverage)family={residual,coverage,base,samples:selected.filter(s=>s.rgb[strongest]>=base[strongest]-8)};
        }
        if(family){
            const radial=family.samples.length>=48?fitRadial(family.samples):null;
            const source=new Uint8ClampedArray(data);
            const rgbAt=i=>[source[i*4],source[i*4+1],source[i*4+2]];
            const at=(x,y)=>{
                if(radial){const u=(x-(x1+x2)/2)/Math.max(1,(x2-x1)/2),v=(y-(y1+y2)/2)/Math.max(1,(y2-y1)/2),basis=[1,u,v,u*u,u*v,v*v];return radial.map(channel=>Math.max(0,Math.min(255,channel.reduce((sum,coefficient,i)=>sum+coefficient*basis[i],0))));}
                const xx=Math.round(x),yy=Math.round(y),sum=[0,0,0];let weight=0;
                // Interpolate from the nearest visible paper in each direction;
                // preserve local tones rather than painting one flat yellow.
                for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){
                    for(let step=1;step<=64;step++){const nx=xx+dx*step,ny=yy+dy*step;if(nx<0||nx>=width||ny<0||ny>=height)break;const rgb=rgbAt(ny*width+nx);if(family.residual(...rgb)<=28){const contribution=1/(step*step*(dx&&dy?2:1));for(let c=0;c<3;c++)sum[c]+=rgb[c]*contribution;weight+=contribution;break;}}
                }
                return weight?sum.map(value=>value/weight):family.base;
            };
            const brightness=.2126*family.base[0]+.7152*family.base[1]+.0722*family.base[2];
            return {at,distance:index=>family.residual(source[index*4],source[index*4+1],source[index*4+2]),centre:family.base,coverage:family.coverage,gradient:false,textured:true,ink:brightness<130?'#fff':'#111'};
        }
        return {reason:inferred?'Texto sem contorno e fundo complexo':'Fundo ilustrado ou variação de cor muito irregular',diagnostics};
    }
    const centreX=(x1+x2)/2,centreY=(y1+y2)/2,radiusX=Math.max(1,(x2-x1)/2),radiusY=Math.max(1,(y2-y1)/2);
    const at=(x,y)=>predict(best.plane,(x-centreX)/radiusX,(y-centreY)/radiusY);
    const distance=index=>{
        const u=(index%width-centreX)/radiusX,v=(Math.floor(index/width)-centreY)/radiusY,p=index*4;
        let residual=0;for(let c=0;c<3;c++){const channel=best.plane[c],value=Math.max(0,Math.min(255,channel[0]+channel[1]*u+channel[2]*v));residual=Math.max(residual,Math.abs(data[p+c]-value));}return residual;
    };
    const centre=at((x1+x2)/2,(y1+y2)/2);
    const linear=centre.map(v=>v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4);
    const luminance=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
    return {at,distance,centre,coverage:best.coverage,gradient:best.variation>8,ink:luminance<.179?'#fff':'#111'};
}

export function recoverLetteringInterior(width,height,bounds,textArea,isPaper,{bridgeRadius=0}={}){
    const [bx,by,bx2,by2]=bounds.map(Math.round),visited=new Uint8Array(width*height),queue=new Int32Array(width*height);
    let best=new Int32Array(0),bestScore=0;
    for(let sy=Math.max(0,by);sy<Math.min(height,by2);sy++)for(let sx=Math.max(0,bx);sx<Math.min(width,bx2);sx++){
        const seed=sy*width+sx;if(visited[seed]||!isPaper(seed))continue;
        let head=0,tail=1,supported=0;queue[0]=seed;visited[seed]=1;
        while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);
            if(x>=textArea[0]&&x<textArea[2]&&y>=textArea[1]&&y<textArea[3])supported++;
            for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
                for(let step=1;step<=1+bridgeRadius;step++){
                    const nx=x+dx*step,ny=y+dy*step;if(nx<Math.max(0,bx)||nx>=Math.min(width,bx2)||ny<Math.max(0,by)||ny>=Math.min(height,by2))break;
                    const n=ny*width+nx;if(isPaper(n)){if(!visited[n]){visited[n]=1;queue[tail++]=n;}break;}
                    // Link paper islands split by thin glyph strokes, only in
                    // OCR support away from the detection box's outer edge.
                    if(!bridgeRadius||nx<textArea[0]||nx>=textArea[2]||ny<textArea[1]||ny>=textArea[3]||nx<bx+2||nx>=bx2-2||ny<by+2||ny>=by2-2)break;
                }
            }
        }
        const score=supported*4+tail;if(supported&&score>bestScore){bestScore=score;best=queue.slice(0,tail);}
    }
    const interior=new Uint8Array(width*height);for(const i of best)interior[i]=1;
    // Fill only enclosed holes (glyphs). Outside-connected gaps and concave
    // corners remain outside, unlike a first/last-pixel envelope of each row.
    const outside=new Uint8Array(width*height);let head=0,tail=0;
    const enqueue=i=>{if(!interior[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
    for(let x=0;x<width;x++){enqueue(x);enqueue((height-1)*width+x);}for(let y=1;y<height-1;y++){enqueue(y*width);enqueue(y*width+width-1);}
    while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width);if(x>0)enqueue(i-1);if(x<width-1)enqueue(i+1);if(y>0)enqueue(i-width);if(y<height-1)enqueue(i+width);}
    for(let i=0;i<interior.length;i++)if(!outside[i])interior[i]=1;
    return interior;
}

// Classical masked reconstruction: smooth field + bounded correction from
// visible paper at the mask boundary. Original pixels outside the mask stay
// untouched. This does not attempt to reconstruct illustrated backgrounds.
export function reconstructLettering(data,width,height,inputMask,interior,allowed,surface,{lineHeight=16}={}){
    const size=width*height,mask=new Uint8Array(inputMask),distance=new Uint16Array(size).fill(65535),queue=new Int32Array(size);
    let head=0,tail=0;
    for(let i=0;i<size;i++)if(!interior[i]){distance[i]=0;queue[tail++]=i;}
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((!x||!y||x===width-1||y===height-1)&&distance[y*width+x]===65535){distance[y*width+x]=1;queue[tail++]=y*width+x;}
    while(head<tail){const i=queue[head++],x=i%width,y=Math.floor(i/width),next=distance[i]+1;
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const n=ny*width+nx;if(distance[n]===65535){distance[n]=next;queue[tail++]=n;}}
    }
    const guard=Math.max(2,Math.min(6,Math.round(lineHeight*.08))),white=surface.ink==='#fff';
    const isInk=i=>{
        if(surface.distance(i)<=30)return false;
        const colour=surface.at(i%width,Math.floor(i/width)),p=i*4;
        const contrast=.2126*(data[p]-colour[0])+.7152*(data[p+1]-colour[1])+.0722*(data[p+2]-colour[2]);
        return white?contrast>25:contrast< -25;
    };
    let recoveredPixels=0;
    for(let i=0;i<size;i++)if(!mask[i]&&allowed[i]&&interior[i]&&distance[i]>=guard&&isInk(i)){
        mask[i]=1;recoveredPixels++;
    }
    // A one-pixel halo around recovered strokes, still confined to OCR support
    // and an eroded balloon interior. Never grow through a contour.
    if(recoveredPixels){const recovered=new Uint8Array(mask);
        for(let i=0;i<size;i++)if(mask[i]&&!inputMask[i]){const x=i%width,y=Math.floor(i/width);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const n=ny*width+nx;if(allowed[n]&&interior[n]&&distance[n]>=guard)recovered[n]=1;}}
        mask.set(recovered);
    }
    const indices=[];let nearBorderInk=0;
    for(let i=0;i<size;i++){if(!interior[i])mask[i]=0;if(mask[i])indices.push(i);else if(allowed[i]&&interior[i]&&distance[i]<guard&&isInk(i))nearBorderInk++;}
    const output=new Uint8ClampedArray(data);
    for(let i=0;i<size;i++)output[i*4+3]=0;
    for(const i of indices){const colour=surface.at(i%width,Math.floor(i/width)),p=i*4;for(let c=0;c<3;c++)output[p+c]=Math.round(colour[c]);output[p+3]=255;}
    let boundarySamples=0,boundaryError=0,method='field';
    // Keep working memory and CPU bounded on long pages/mobile devices.
    if(indices.length&&indices.length<=100000&&size<=500000){
        const lookup=new Int32Array(size).fill(-1);indices.forEach((i,k)=>{lookup[i]=k;});
        const neighbours=new Int32Array(indices.length*4).fill(-1),counts=new Uint8Array(indices.length),fixed=new Float32Array(indices.length*3);
        const limit=surface.textured||surface.gradient?24:12;
        indices.forEach((i,k)=>{const x=i%width,y=Math.floor(i/width);let slot=0;
            for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=x+dx,ny=y+dy;if(nx<0||nx>=width||ny<0||ny>=height)continue;const n=ny*width+nx;
                if(lookup[n]>=0){neighbours[k*4+slot++]=lookup[n];counts[k]++;}
                else if(interior[n]&&surface.distance(n)<=16){const colour=surface.at(nx,ny),p=n*4;let error=0;for(let c=0;c<3;c++){const delta=data[p+c]-colour[c];fixed[k*3+c]+=Math.max(-limit,Math.min(limit,delta));error+=Math.abs(delta);}counts[k]++;boundarySamples++;boundaryError+=error/3;}
            }
        });
        let current=new Float32Array(indices.length*3),next=new Float32Array(current.length);
        for(let iteration=0;iteration<18;iteration++){
            for(let k=0;k<indices.length;k++)for(let c=0;c<3;c++){let sum=fixed[k*3+c];for(let slot=0;slot<4;slot++){const n=neighbours[k*4+slot];if(n>=0)sum+=current[n*3+c];}next[k*3+c]=counts[k]?sum/counts[k]:0;}
            [current,next]=[next,current];
        }
        indices.forEach((i,k)=>{for(let c=0;c<3;c++)output[i*4+c]=Math.max(0,Math.min(255,output[i*4+c]+current[k*3+c]));});
        method='field+boundary-diffusion';
    }
    return {mask,pixels:output,quality:{maskPixels:indices.length,recoveredPixels,nearBorderInk,boundarySamples,meanBoundaryError:boundarySamples?boundaryError/boundarySamples:0,method}};
}
