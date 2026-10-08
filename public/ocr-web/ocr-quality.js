import {overlap} from './vision.js';
// Conservative chapter filters. Raw OCR remains cached and inspectable.
export function selectSegments(segments,scope='all',filterNoise=true){
    const selected=[],ignored=[];
    for(const original of segments){
        const segment=structuredClone(original),text=segment.sourceText.trim(),inBalloon=!!segment.bubble||segment.textKind==='bubble-text',confidence=segment.lines?.length?segment.lines.reduce((sum,line)=>sum+line.confidence,0)/segment.lines.length:null;
        let reason='';
        if(!text)reason='Sem texto reconhecido';
        else if(scope==='balloons'&&!inBalloon)reason='Fora de um balão';
        else if(filterNoise&&!inBalloon&&!/\p{L}/u.test(text))reason='Número ou símbolo fora de balão';
        else if(filterNoise&&!inBalloon&&/^s\d+$/i.test(text))reason='Código curto fora de balão';
        else if(filterNoise&&confidence!==null&&confidence<.65)reason='Reconhecimento incerto';
        else if(filterNoise&&!inBalloon&&text.replace(/[^\p{L}]/gu,'').length<3&&confidence!==null&&confidence<.9)reason='Trecho curto e incerto fora de balão';
        else if(filterNoise&&selected.some(s=>{
            const a=s.sourceText.replace(/\s+/g,' ').trim(),b=text.replace(/\s+/g,' ').trim();
            if(a===b&&overlap(s.box,segment.box)>.6)return true;
            return s.lines?.some(line=>segment.lines?.some(other=>line.text.trim()===other.text.trim()&&overlap(line.box,other.box)>.6))&&a.includes(b);
        }))reason='Detecção duplicada na mesma região';
        if(reason)ignored.push({...segment,reason});else selected.push(segment);
    }
    return {segments:selected,ignoredSegments:ignored,rawSegmentCount:segments.length};
}
