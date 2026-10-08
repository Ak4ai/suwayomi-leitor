export function normalize(text) {
    return text.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function distance(a, b) {
    let prev = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
        const row = [i + 1];
        for (let j = 0; j < b.length; j++) {
            row.push(Math.min(row[j] + 1, prev[j + 1] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
        }
        prev = row;
    }
    return prev[b.length];
}
export function metrics(reference, text) {
    const ref = normalize(reference), hyp = normalize(text);
    if (!ref) return null;
    if (ref.length * hyp.length > 16000000) return {unavailable: 'Texto longo demais para calcular métricas nesta tela.'};
    const refWords = ref.split(' '), hypWords = hyp ? hyp.split(' ') : [];
    return {cer: distance([...ref], [...hyp]) / [...ref].length, wer: distance(refWords, hypWords) / refWords.length};
}
