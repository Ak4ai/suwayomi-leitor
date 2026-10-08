// Geometry/CTC helpers shared by browser worker and deterministic unit tests.
export function overlap(a,b) {
    const intersection = Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])) * Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
    return intersection / Math.max(1,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection);
}
export function suppress(regions, threshold=.4) {
    const remaining = [...regions].sort((a,b)=>b.score-a.score), kept=[];
    for (const region of remaining) if (!kept.some(r=>overlap(r.box,region.box)>threshold)) kept.push(region);
    return kept;
}
export function clampBox(box,w,h) {
    return box.map((v,i)=>Math.max(0,Math.min(i%2 ? h:w,Math.round(v))));
}
export function associateBubble(box,bubbles){
    const area=Math.max(1,(box[2]-box[0])*(box[3]-box[1])),cx=(box[0]+box[2])/2,cy=(box[1]+box[3])/2;
    return bubbles.filter(({box:b})=>{
        const intersection=Math.max(0,Math.min(box[2],b[2])-Math.max(box[0],b[0]))*Math.max(0,Math.min(box[3],b[3])-Math.max(box[1],b[1]));
        return cx>=b[0]&&cx<=b[2]&&cy>=b[1]&&cy<=b[3]&&intersection/area>=.8;
    }).sort((a,b)=>(a.box[2]-a.box[0])*(a.box[3]-a.box[1])-(b.box[2]-b.box[0])*(b.box[3]-b.box[1]))[0];
}
export function removeTinyLines(lines){return lines.filter(line=>{const b=line.box;return (b[2]-b[0])*(b[3]-b[1])>=16||(b[3]-b[1])>=4;});}
export function mergeLineFragments(lines){
    const result=lines.map(line=>({...line,box:[...line.box]}));
    const removed=new Set();
    for(let i=0;i<result.length;i++){
        if(removed.has(i))continue;
        const a=result[i].box,ah=a[3]-a[1],aw=a[2]-a[0];
        let best=-1,bestGap=Infinity;
        for(let j=0;j<result.length;j++){
            if(i===j||removed.has(j))continue;
            const b=result[j].box,bh=b[3]-b[1];
            if(ah>bh*.55||aw>bh*.8||b[2]-b[0]<bh*2)continue;
            const vertical=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
            const gap=Math.max(0,b[0]-a[2],a[0]-b[2]);
            if(vertical/Math.max(1,ah)>=.6&&gap<=bh*1.5&&gap<bestGap){best=j;bestGap=gap;}
        }
        if(best>=0){const b=result[best].box;result[best].box=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];result[best].hadFragments=true;removed.add(i);}
    }
    return result.filter((_,i)=>!removed.has(i)).sort((a,b)=>(a.box[1]+a.box[3])-(b.box[1]+b.box[3]));
}
export function limitLineOverlap(lines){
    const useful=removeTinyLines(lines).sort((a,b)=>(a.box[1]+a.box[3])-(b.box[1]+b.box[3]));
    return useful.map((line,i)=>{
        const box=[...line.box],center=(box[1]+box[3])/2;
        if(i>0){const previous=useful[i-1].box;box[1]=Math.max(box[1],Math.floor(((previous[1]+previous[3])/2+center)/2));}
        if(i+1<useful.length){const next=useful[i+1].box;box[3]=Math.min(box[3],Math.ceil((center+(next[1]+next[3])/2)/2));}
        return {...line,box};
    }).filter(line=>line.box[3]-line.box[1]>=2);
}
export function decodeCTC(data,dims,characters) {
    const classes=dims.at(-1), steps=dims.at(-2);
    if (classes!==characters.length) throw new Error('Dicionário incompatível com o modelo OCR.');
    let last=-1,text='',sum=0,count=0;
    for (let step=0;step<steps;step++) {
        let index=0,score=-Infinity;
        for (let j=0;j<classes;j++) if (data[step*classes+j]>score) {score=data[step*classes+j];index=j;}
        if (index!==0 && index!==last) {text+=characters[index];sum+=score;count++;}
        last=index;
    }
    return {text:text.trim(),confidence:count ? sum/count:0};
}
export function lineComponents(probabilities,width,height,sourceWidth,sourceHeight) {
    // Approximate DB postprocessing for horizontal English: connected regions,
    // axis-aligned boxes and expansion. Not upstream polygon/rotation processing.
    const visited=new Uint8Array(width*height), queue=new Int32Array(width*height), boxes=[];
    for (let seed=0;seed<visited.length;seed++) {
        if (visited[seed] || probabilities[seed]<.3) continue;
        let head=0,tail=1,area=0,sum=0,left=width,top=height,right=0,bottom=0;
        queue[0]=seed;visited[seed]=1;
        while (head<tail) {
            const p=queue[head++],x=p%width,y=Math.floor(p/width);
            area++;sum+=probabilities[p];left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
            for (const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
                if (nx<0 || ny<0 || nx>=width || ny>=height) continue;
                const next=ny*width+nx;
                if (!visited[next] && probabilities[next]>=.3) {visited[next]=1;queue[tail++]=next;}
            }
        }
        const w=right-left+1,h=bottom-top+1;
        if (area<5 || w<3 || h<2 || sum/area<.5) continue;
        const margin=(w*h*1.6)/(2*(w+h));
        const box=clampBox([(left-margin)*sourceWidth/width,(top-margin)*sourceHeight/height,
            (right+1+margin)*sourceWidth/width,(bottom+1+margin)*sourceHeight/height],sourceWidth,sourceHeight);
        boxes.push({box,score:sum/area});
    }
    // DB can separate words. Group aligned words before recognition, so slight
    // differences in their top edges do not scramble the reading order.
    const rows=[];
    for(const item of suppress(boxes,.5).sort((a,b)=>(a.box[1]+a.box[3])-(b.box[1]+b.box[3]))){
        const b=item.box,center=(b[1]+b[3])/2;
        const row=rows.find(r=>Math.abs(r.center-center)<.35*Math.min(r.height,b[3]-b[1]));
        if(row){row.items.push(item);}else rows.push({center,height:b[3]-b[1],items:[item]});
    }
    return rows.map(row=>({box:[Math.min(...row.items.map(i=>i.box[0])),Math.min(...row.items.map(i=>i.box[1])),Math.max(...row.items.map(i=>i.box[2])),Math.max(...row.items.map(i=>i.box[3]))],score:Math.min(...row.items.map(i=>i.score))}));
}
