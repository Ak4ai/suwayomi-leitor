import { createCanvas } from './lettering.js';

// Highlight for redrawn balloons: a soft, diffuse rounded glow around a text
// block, independent of the balloon cut-out (which follows the cleanup and can
// be irregular, e.g. after AI inpainting). Built like a smoothed selection: one
// rectangle per line, expanded and blurred, so the lines merge into one rounded
// shape roughly following the text; the glow is a wide, faint band around that
// shape's midpoint contour, blurred again so it reads as light, not as a line.
// One small image per balloon and per text (translated, original OCR lines),
// with margin for the glow to fade to zero: the reader places each one where it
// belongs, so nothing is cut and neighbouring balloons never bleed in.
const GLOW = [100, 181, 246];
const MAX_WIDTH = 1100;
const BAND = 0.22;
const OPACITY = 0.6;

// Glow alpha (0–1) from the blurred selection (0–1): strongest on the 0.5 contour, fading both ways.
export function borderAlpha(field) {
    const t = Math.max(0, 1 - Math.abs(field - 0.5) / BAND);
    return t * t * (3 - 2 * t);
}

// item: { outline?: [[x, y]], translated: { boxes, size }, original: { boxes, size } | null } in raster
// pixels; boxes are [x0, y0, x1, y1] line boxes. which: 'translated' | 'original'. The balloon outline
// is used only to fade the glow where the text nearly touches the balloon line, so it never crosses it.
// Returns the sprite and its place on the page, normalised [x, y, w, h], or null.
export function renderGlowSprite(width, height, item, which) {
    const text = item[which];
    if (!text?.boxes.length) return null;
    const scale = Math.min(1, MAX_WIDTH / width),
        boxes = text.boxes.map((box) => box.map((value) => value * scale)),
        size = text.size * scale,
        pad = size * 0.5,
        blur = size * 0.5,
        feather = Math.max(1, size * 0.22),
        // Wide enough for both blurs to reach zero inside the sprite.
        margin = Math.ceil(pad + blur * 3 + feather * 3 + 2);
    const x0 = Math.floor(Math.min(...boxes.map((b) => b[0]))) - margin,
        y0 = Math.floor(Math.min(...boxes.map((b) => b[1]))) - margin,
        w = Math.ceil(Math.max(...boxes.map((b) => b[2]))) + margin - x0,
        h = Math.ceil(Math.max(...boxes.map((b) => b[3]))) + margin - y0;
    // Selection: expanded line rectangles.
    const selection = createCanvas(w, h),
        sctx = selection.getContext('2d');
    sctx.fillStyle = '#fff';
    for (const [a, b, c, d] of boxes) sctx.fillRect(a - x0 - pad, b - y0 - pad, c - a + pad * 2, d - b + pad * 2);
    // Smooth: blur, then read the field and keep a soft band around its midpoint.
    const field = createCanvas(w, h),
        fctx = field.getContext('2d', { willReadFrequently: true });
    fctx.filter = `blur(${blur.toFixed(1)}px)`;
    fctx.drawImage(selection, 0, 0);
    const values = fctx.getImageData(0, 0, w, h).data,
        band = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        band.data.set(GLOW, i * 4);
        band.data[i * 4 + 3] = Math.round(borderAlpha(values[i * 4 + 3] / 255) * OPACITY * 255);
    }
    const layer = createCanvas(w, h),
        lctx = layer.getContext('2d');
    lctx.putImageData(band, 0, 0);
    if (item.outline?.length > 2) {
        lctx.globalCompositeOperation = 'destination-in';
        lctx.filter = `blur(${Math.max(0.8, size * 0.15).toFixed(1)}px)`;
        lctx.beginPath();
        item.outline.forEach(([x, y], index) => {
            const px = x * scale - x0,
                py = y * scale - y0;
            if (index) lctx.lineTo(px, py);
            else lctx.moveTo(px, py);
        });
        lctx.closePath();
        lctx.fillStyle = '#000';
        lctx.fill();
    }
    // Diffuse: a wide blur so it reads as light around the text, not as a drawn line.
    const sprite = createCanvas(w, h),
        ctx = sprite.getContext('2d');
    ctx.filter = `blur(${feather.toFixed(1)}px)`;
    ctx.drawImage(layer, 0, 0);
    const pageWidth = width * scale,
        pageHeight = height * scale,
        round = (value) => +value.toFixed(5);
    return {
        canvas: sprite,
        rect: [round(x0 / pageWidth), round(y0 / pageHeight), round(w / pageWidth), round(h / pageHeight)],
    };
}
