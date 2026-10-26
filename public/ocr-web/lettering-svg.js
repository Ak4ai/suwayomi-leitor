import { ReadableLettering, canvasBlob, createCanvas } from './lettering.js';

const escapeXML = (value) =>
    String(value)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fontFile = (style) => {
    if (style.family === 'bangers') return 'Bangers-Regular.ttf';
    const bold = style.weight !== '400',
        italic = style.slant === 'italic';
    return `ComicNeue-${bold ? 'Bold' : italic ? '' : 'Regular'}${italic ? 'Italic' : ''}.ttf`;
};
const fontBytes = new Map();
function loadFontBytes(file, signal) {
    let bytes = fontBytes.get(file);
    if (!bytes) {
        bytes = fetch(new URL(file, import.meta.url), { signal }).then((response) => {
            if (!response.ok) throw Error(`Fonte SVG indisponível: ${file}`);
            return response.arrayBuffer();
        });
        bytes.catch(() => fontBytes.delete(file));
        fontBytes.set(file, bytes);
    }
    return bytes;
}
// Glyph outlines need a font parser. vendor/ is prepared by reader:prepare;
// without it, letters fall back to <text> with the embedded font.
let opentype = null;
const outlineFonts = new Map();
async function outlineFont(style, signal) {
    opentype ??= import('./vendor/opentype.module.js').catch(() => null);
    const parser = await opentype;
    if (!parser) return null;
    const file = fontFile(style);
    if (!outlineFonts.has(file)) outlineFonts.set(file, parser.parse(await loadFontBytes(file, signal)));
    return outlineFonts.get(file);
}
async function embeddedFont(style, signal) {
    const bangers = style.family === 'bangers',
        bold = style.weight !== '400',
        italic = style.slant === 'italic';
    const bytes = new Uint8Array(await loadFontBytes(fontFile(style), signal));
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return `@font-face{font-family:'${bangers ? 'Bangers Local' : 'Comic Neue Local'}';font-weight:${bangers ? '400' : bold ? '700' : '400'};font-style:${bangers ? 'normal' : italic ? 'italic' : 'normal'};src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype');}`;
}
// Same placement as Canvas fillText with textAlign center: the advance
// width (with kerning) is centred on x and the baseline sits on y.
export function outlineLine(font, text, x, y, size) {
    const options = { kerning: true };
    const left = x - font.getAdvanceWidth(text, size, options) / 2;
    return font.getPath(text, left, y, size, options).toPathData(2);
}

// Light variant: each glyph is a <path> in font units, defined once in <defs>
// and placed with <use>. Positions come from opentype's own layout (kerning
// and ligatures), so the result matches outlineLine.
export function glyphLine(font, text, x, y, size, defs, file) {
    const units = font.unitsPerEm,
        uses = [];
    const left = -font.getAdvanceWidth(text, units, { kerning: true }) / 2;
    font.forEachGlyph(text, left, 0, units, { kerning: true }, (glyph, gx) => {
        if (!glyph.path?.commands?.length) return;
        const key = `${file}:${glyph.index}`;
        if (!defs.has(key)) defs.set(key, { id: `g${defs.size}`, d: glyph.getPath(0, 0, units).toPathData(0) });
        uses.push([defs.get(key).id, Math.round(gx)]);
    });
    return { x, y, scale: size / units, uses };
}
export function buildLetteringSVG({
    width,
    height,
    rasterWidth,
    rasterHeight,
    background,
    fontCSS,
    textLayers,
    glyphs,
}) {
    const layers = textLayers
        .map((layer) => {
            const family = layer.style.family === 'bangers' ? 'Bangers Local' : 'Comic Neue Local';
            const weight =
                layer.style.family === 'bangers' ? '400' : layer.style.weight === '900' ? '700' : layer.style.weight;
            // Outlines keep counters open at small scales, so they take the
            // same reinforcement as Canvas, which the layout already reserves.
            // The <text> fallback keeps the restrained 1.5% stroke: browsers
            // close counters when a thin stroke is drawn on hinted glyphs.
            const reinforcement =
                layer.paths || layer.glyphLines
                    ? layer.stroke
                    : layer.style.family === 'comic' && layer.style.weight !== '400'
                      ? layer.size * 0.015
                      : 0;
            const paint = `fill="${layer.ink}" stroke="${reinforcement ? layer.ink : 'none'}" stroke-width="${reinforcement}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"`;
            // Outlined letters are filled like any other vector shape, the way
            // PDF viewers draw text: no hinting or glyph-size snapping when the
            // page is scaled down. The original text stays in <title>.
            if (layer.glyphLines) {
                // Stroke is set in font units because <use> sits inside scale().
                const scale = layer.glyphLines[0]?.scale || 1;
                return `<g data-segment="${escapeXML(layer.id)}" fill="${layer.ink}" stroke="${reinforcement ? layer.ink : 'none'}" stroke-width="${+(reinforcement / scale).toFixed(1)}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"><title>${escapeXML(layer.lines.map((line) => line.text).join(' '))}</title>${layer.glyphLines.map((line) => `<g transform="translate(${+line.x.toFixed(2)} ${+line.y.toFixed(2)}) scale(${+line.scale.toFixed(6)})">${line.uses.map(([id, x]) => `<use href="#${id}" x="${x}"/>`).join('')}</g>`).join('')}</g>`;
            }
            if (layer.paths)
                return `<g data-segment="${escapeXML(layer.id)}" ${paint}><title>${escapeXML(layer.lines.map((line) => line.text).join(' '))}</title>${layer.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
            return `<g data-segment="${escapeXML(layer.id)}" font-family="${family}" font-size="${layer.size}" font-weight="${weight}" font-style="${layer.style.slant}" ${paint} text-anchor="middle">${layer.lines.map((line) => `<text x="${line.x}" y="${line.y}">${escapeXML(line.text)}</text>`).join('')}</g>`;
        })
        .join('\n');
    // SVG loaded through <img> cannot rely on external fonts/images. Embed
    // both so the document remains self-contained and also works as a file.
    // geometricPrecision disables hinting and integer font-size snapping for
    // the <text> fallback, which distort glyphs when the page is scaled down.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rasterWidth} ${rasterHeight}" text-rendering="geometricPrecision">${fontCSS ? `<style>${fontCSS}</style>` : ''}${glyphs?.size ? `<defs>${[...glyphs.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join('')}</defs>` : ''}<image width="${rasterWidth}" height="${rasterHeight}" preserveAspectRatio="none" href="${background}"/>${layers}</svg>`;
}
const dataURL = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
export async function renderLetteringSVG(
    image,
    segments,
    {
        fontReady = true,
        scale = 1,
        signal,
        background: cleanedBackground,
        skipCleanup = false,
        regionOverrides,
        light = false,
    } = {},
) {
    signal?.throwIfAborted();
    const background = createCanvas();
    const paint = new ReadableLettering().paint(background, image, segments, {
        translated: true,
        fontReady,
        scale,
        vectorText: true,
        background: cleanedBackground,
        skipCleanup,
        regionOverrides,
    });
    const glyphs = new Map();
    const textLayers = await Promise.all(
        paint.textLayers.map(async (layer) => {
            const font = await outlineFont(layer.style, signal);
            if (!font) return layer;
            if (light)
                return {
                    ...layer,
                    glyphLines: layer.lines.map((line) =>
                        glyphLine(font, line.text, line.x, line.y, layer.size, glyphs, fontFile(layer.style)),
                    ),
                };
            return {
                ...layer,
                paths: layer.lines.map((line) => outlineLine(font, line.text, line.x, line.y, layer.size)),
            };
        }),
    );
    const styles = new Map();
    for (const layer of textLayers) if (!layer.paths) styles.set(JSON.stringify(layer.style), layer.style);
    const fontCSS = (await Promise.all([...styles.values()].map((style) => embeddedFont(style, signal)))).join('\n');
    // The light variant embeds JPEG: the text is vector on top, so lossy
    // compression never touches letters, and the SVG is ~6x smaller and
    // much faster for the browser to decode on the interface thread.
    // Light variant also keeps the background at the source resolution. The
    // raster is upscaled (up to 3x) only so Canvas letters stay sharp; here
    // letters are vectors, and <image> stretches the background to the same
    // viewBox, so small scans decode up to 9x fewer pixels.
    let embedded = background;
    if (light && background.width > image.width) {
        embedded = createCanvas(image.width, image.height);
        const ctx = embedded.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(background, 0, 0, image.width, image.height);
    }
    const backgroundURL = await dataURL(
        await (light ? canvasBlob(embedded, 'image/jpeg', 0.92) : canvasBlob(background)),
    );
    signal?.throwIfAborted();
    // Same intrinsic size as the Canvas PNG. The reader's "fit" modes only
    // shrink pages, so declaring the smaller source size made SVG pages look
    // zoomed out compared with Canvas on low-resolution scans.
    const svg = buildLetteringSVG({
        width: background.width,
        height: background.height,
        rasterWidth: background.width,
        rasterHeight: background.height,
        background: backgroundURL,
        fontCSS,
        textLayers,
        glyphs,
    });
    return {
        ...paint,
        textLayers,
        blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        svg,
        renderer: light ? 'svg-light' : 'svg',
    };
}
