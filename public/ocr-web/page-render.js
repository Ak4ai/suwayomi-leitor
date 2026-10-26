import { ReadableLettering, canvasBlob, createCanvas, loadLetteringFonts } from './lettering.js';
import { renderLetteringSVG } from './lettering-svg.js';
import { AIInpainter } from './inpaint-ai.js';
import { renderGlowSprite } from './balloon-glow.js';

// Cleanup, layout and encoding of one translated page. It runs inside
// render-worker.js so the reader stays responsive; the same code is the
// fallback on the page when workers lack OffscreenCanvas or FontFace.
const inpainter = new AIInpainter();
let fonts = null;
export const stopRender = () => inpainter.stop();
export async function renderPage(
    blob,
    segments,
    { renderer, inpaint, inpaintDevice },
    { signal, onProgress = () => {} } = {},
) {
    fonts ??= loadLetteringFonts().catch((error) => {
        fonts = null;
        throw error;
    });
    await fonts;
    signal?.throwIfAborted();
    const image = await createImageBitmap(blob);
    let paint, output, ai;
    try {
        if (['ai', 'hybrid'].includes(inpaint)) {
            onProgress('Preparando limpeza com IA…');
            ai = await inpainter.process(image, blob, segments, {
                signal,
                mode: inpaintDevice || 'auto',
                strategy: inpaint === 'hybrid' ? 'hybrid' : 'all',
                onProgress,
            });
        }
        const cleanup = ai ? { background: ai.background, skipCleanup: true, regionOverrides: ai.overrides } : {};
        if (renderer === 'svg' || renderer === 'svg-light') {
            paint = await renderLetteringSVG(image, segments, { signal, light: renderer === 'svg-light', ...cleanup });
            output = paint.blob;
        } else {
            const canvas = createCanvas();
            paint = new ReadableLettering().paint(canvas, image, segments, {
                translated: true,
                fontReady: true,
                ...cleanup,
            });
            output = await canvasBlob(canvas);
        }
    } finally {
        if (ai?.ownsBackground) ai.background.close();
        image.close();
    }
    if (!output) throw Error('Não foi possível renderizar a tradução.');
    // Highlight around the translated text, and around the original text for when a balloon shows it.
    // One small image per balloon and text, placed by the reader (normalised rect), never clipped.
    const sprite = async (item, which) => {
        const glow = renderGlowSprite(paint.width, paint.height, item, which);
        return glow && { blob: await canvasBlob(glow.canvas), rect: glow.rect };
    };
    const glows = [];
    for (const item of paint.glowItems ?? [])
        glows.push({
            id: item.id,
            translated: await sprite(item, 'translated'),
            original: await sprite(item, 'original'),
        });
    return {
        blob: output,
        glows,
        applied: paint.applied,
        notes: [...paint.notes],
        balloons: paint.balloons,
        inpaintMetrics: ai?.metrics,
    };
}
