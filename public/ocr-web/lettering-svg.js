import { ReadableLettering } from './lettering.js';

const escapeXML = (value) =>
    String(value)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fonts = new Map();
async function embeddedFont(style, signal) {
    const bangers = style.family === 'bangers',
        bold = style.weight !== '400',
        italic = style.slant === 'italic';
    const file = bangers
        ? 'Bangers-Regular.ttf'
        : `ComicNeue-${bold ? 'Bold' : 'Regular'}${italic ? (bold ? 'Italic' : '') : ''}.ttf`;
    const resolvedFile = !bangers && italic && !bold ? 'ComicNeue-Italic.ttf' : file;
    let encoded = fonts.get(resolvedFile);
    if (!encoded) {
        const response = await fetch(new URL(resolvedFile, import.meta.url), { signal });
        if (!response.ok) throw Error(`Fonte SVG indisponível: ${resolvedFile}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        encoded = btoa(binary);
        fonts.set(resolvedFile, encoded);
    }
    return `@font-face{font-family:'${bangers ? 'Bangers Local' : 'Comic Neue Local'}';font-weight:${bangers ? '400' : bold ? '700' : '400'};font-style:${bangers ? 'normal' : italic ? 'italic' : 'normal'};src:url(data:font/ttf;base64,${encoded}) format('truetype');}`;
}

export function buildLetteringSVG({ width, height, rasterWidth, rasterHeight, background, fontCSS, textLayers }) {
    const layers = textLayers
        .map((layer) => {
            const family = layer.style.family === 'bangers' ? 'Bangers Local' : 'Comic Neue Local';
            const weight =
                layer.style.family === 'bangers' ? '400' : layer.style.weight === '900' ? '700' : layer.style.weight;
            // A restrained reinforcement, one third of the former Canvas
            // stroke, with rounded joins. Regular faces retain their weight.
            const reinforcement =
                layer.style.family === 'comic' && layer.style.weight !== '400' ? layer.size * 0.015 : 0;
            return `<g data-segment="${escapeXML(layer.id)}" font-family="${family}" font-size="${layer.size}" font-weight="${weight}" font-style="${layer.style.slant}" fill="${layer.ink}" stroke="${reinforcement ? layer.ink : 'none'}" stroke-width="${reinforcement}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill" text-anchor="middle">${layer.lines.map((line) => `<text x="${line.x}" y="${line.y}">${escapeXML(line.text)}</text>`).join('')}</g>`;
        })
        .join('\n');
    // SVG loaded through <img> cannot rely on external fonts/images. Embed
    // both so the document remains self-contained and also works as a file.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rasterWidth} ${rasterHeight}"><style>${fontCSS}</style><image width="${rasterWidth}" height="${rasterHeight}" href="${background}"/>${layers}</svg>`;
}
export async function renderLetteringSVG(
    image,
    segments,
    { fontReady = true, scale = 1, signal, background: cleanedBackground, skipCleanup = false, regionOverrides } = {},
) {
    signal?.throwIfAborted();
    const background = document.createElement('canvas');
    const paint = new ReadableLettering().paint(background, image, segments, {
        translated: true,
        fontReady,
        scale,
        vectorText: true,
        background: cleanedBackground,
        skipCleanup,
        regionOverrides,
    });
    const styles = new Map();
    for (const layer of paint.textLayers) styles.set(JSON.stringify(layer.style), layer.style);
    const fontCSS = (await Promise.all([...styles.values()].map((style) => embeddedFont(style, signal)))).join('\n');
    signal?.throwIfAborted();
    const svg = buildLetteringSVG({
        width: image.width,
        height: image.height,
        rasterWidth: background.width,
        rasterHeight: background.height,
        background: background.toDataURL('image/png'),
        fontCSS,
        textLayers: paint.textLayers,
    });
    return { ...paint, blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), svg, renderer: 'svg' };
}
