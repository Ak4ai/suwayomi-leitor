export function imageQuality(width,height){
    const small=Math.min(width,height)<480&&Math.max(width,height)<800;
    return {width,height,small,message:small?`Imagem recebida em ${width}×${height}, muito pequena para OCR confiável desta página. Use uma fonte/arquivo em resolução normal; ampliar a miniatura não recupera as letras. Para experimentar mesmo assim, marque Permitir imagens pequenas e refaça o OCR.`:''};
}
