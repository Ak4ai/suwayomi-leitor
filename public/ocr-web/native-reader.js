import { ChapterEngine, ChapterCache } from './chapter-engine.js';
import { ReadableLettering, loadLetteringFonts } from './lettering.js';
import { loadPreferences, savePreferences } from './chapter-preferences.js';
import { listGeminiModels } from './translation.js';
import { renderLetteringSVG } from './lettering-svg.js';
import { AIInpainter } from './inpaint-ai.js';
const inpainter = new AIInpainter();
const renderedCache = new ChapterCache(0);
const listeners = new Set();
let sessionPreferences = loadPreferences();
const saved = (() => {
    try {
        return JSON.parse(localStorage.getItem('ihc-native-reader') || '{}');
    } catch {
        return {};
    }
})();
let state = { enabled: !!saved.enabled, showInfo: !!saved.showInfo, pages: {}, current: 0 };
let urls = [],
    chapter = '',
    generation = 0,
    running = false,
    controller = null,
    engine = new ChapterEngine(),
    fonts = null;
const emit = () => {
    state = { ...state, pages: { ...state.pages } };
    for (const fn of listeners) fn();
};
export const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
export const getSnapshot = () => state;
export const getPreferences = () => ({ ...sessionPreferences });
export const getModels = (key) => listGeminiModels(key, AbortSignal.timeout(30000));
export function setPreferences(patch) {
    sessionPreferences = { ...sessionPreferences, ...patch };
    savePreferences(sessionPreferences);
    stop();
    clear();
    emit();
    void pump();
}
const save = () => {
    try {
        localStorage.setItem('ihc-native-reader', JSON.stringify({ enabled: state.enabled, showInfo: state.showInfo }));
    } catch {}
};
const stop = () => {
    generation++;
    controller?.abort();
    controller = null;
    engine.stop();
    inpainter.stop();
};
const clear = () => {
    for (const p of Object.values(state.pages)) if (p.image) URL.revokeObjectURL(p.image);
    state.pages = {};
};
export function toggle(key, value) {
    state[key] = value;
    save();
    if (key === 'enabled' && !value) stop();
    emit();
    void pump();
}
export function configure(id, pageUrls, current) {
    if (chapter !== id) {
        stop();
        clear();
        chapter = id;
    }
    urls = pageUrls;
    state.current = Math.max(0, Math.min(current, Math.max(0, urls.length - 1)));
    releaseDistantImages();
    emit();
    void pump();
}
export function dispose() {
    stop();
    clear();
    urls = [];
    chapter = '';
    emit();
}
export function retry() {
    stop();
    const p = state.pages[urls[state.current]];
    if (p?.image) URL.revokeObjectURL(p.image);
    state.pages[urls[state.current]] = { index: state.current, status: 'retry', forceRender: true };
    emit();
    void pump();
}
// Keep completion records so evicted pages are not repeatedly queued.
function releaseDistantImages() {
    for (const p of Object.values(state.pages))
        if (p.image && Math.abs(p.index - state.current) > 4) {
            URL.revokeObjectURL(p.image);
            p.image = null;
            p.result = null;
        }
}
async function pump() {
    if (running || !state.enabled || !urls.length) return;
    running = true;
    const epoch = generation;
    try {
        while (state.enabled && generation === epoch) {
            const candidates = [
                state.current,
                ...Array.from({ length: urls.length - state.current - 1 }, (_, i) => state.current + i + 1),
                ...Array.from({ length: state.current }, (_, i) => i),
            ];
            const index = candidates.find(
                (n) =>
                    !state.pages[urls[n]] ||
                    state.pages[urls[n]].status === 'retry' ||
                    (n === state.current && state.pages[urls[n]].status === 'ready' && !state.pages[urls[n]].image),
            );
            if (index === undefined) break;
            const url = urls[index],
                entry = {
                    index,
                    forceRender: state.pages[url]?.forceRender,
                    status: 'loading',
                    message: 'Carregando imagem',
                    image: null,
                    applied: 0,
                    result: null,
                };
            state.pages[url] = entry;
            emit();
            controller = new AbortController();
            const signal = controller.signal;
            const update = (patch) => {
                if (generation !== epoch || signal.aborted) return;
                Object.assign(entry, patch);
                emit();
            };
            try {
                const preferences = { ...sessionPreferences },
                    provider = preferences.provider || 'google';
                if (provider === 'gemini' && (!preferences.key || !preferences.model))
                    throw Error('Configure a chave e o modelo Gemini nas configurações da tradução.');
                const renderKey =
                    'native-render-v2:' +
                    JSON.stringify([
                        chapter,
                        url,
                        preferences.provider,
                        preferences.model,
                        preferences.mode,
                        preferences.opusVariant,
                        preferences.opusNormalize,
                        preferences.renderer,
                        preferences.inpaint,
                        preferences.inpaintDevice,
                    ]);
                const cachedRender = entry.forceRender ? null : await renderedCache.get(renderKey);
                signal.throwIfAborted();
                if (cachedRender?.blob) {
                    Object.assign(entry, cachedRender.entry, {
                        diskCached: true,
                        image: URL.createObjectURL(cachedRender.blob),
                    });
                    releaseDistantImages();
                    emit();
                    continue;
                }
                const response = await fetch(url, { credentials: 'include', signal });
                if (!response.ok) throw Error('Imagem HTTP ' + response.status);
                const blob = await response.blob();
                const result = await engine.process(
                    {},
                    blob,
                    {
                        mode: preferences.mode || 'wasm',
                        threads: 4,
                        provider,
                        opusVariant: preferences.opusVariant || 'compact',
                        opusNormalize: preferences.opusNormalize !== false,
                        key: preferences.key || '',
                        model: preferences.model || '',
                        scope: 'all',
                        filterNoise: true,
                        allowSmallImages: false,
                    },
                    signal,
                    update,
                );
                if (generation !== epoch || signal.aborted) break;
                fonts ??= loadLetteringFonts();
                await fonts;
                signal.throwIfAborted();
                const image = await createImageBitmap(blob),
                    canvas = document.createElement('canvas');
                let paint, output, ai;
                try {
                    if (['ai', 'hybrid'].includes(preferences.inpaint)) {
                        update({ message: 'Preparando limpeza com IA…' });
                        ai = await inpainter.process(image, blob, result.segments, {
                            signal,
                            mode: preferences.inpaintDevice || 'auto',
                            strategy: preferences.inpaint === 'hybrid' ? 'hybrid' : 'all',
                            onProgress: (message) => update({ message }),
                        });
                    }
                    const cleanup = ai
                        ? { background: ai.background, skipCleanup: true, regionOverrides: ai.overrides }
                        : {};
                    if (preferences.renderer === 'svg') {
                        paint = await renderLetteringSVG(image, result.segments, { signal, ...cleanup });
                        output = paint.blob;
                    } else {
                        paint = new ReadableLettering().paint(canvas, image, result.segments, {
                            translated: true,
                            fontReady: true,
                            ...cleanup,
                        });
                        output = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                    }
                } finally {
                    if (ai?.ownsBackground) ai.background.close();
                    image.close();
                }
                if (generation !== epoch || signal.aborted) break;
                if (!output) throw Error('Não foi possível renderizar a tradução.');
                entry.image = URL.createObjectURL(output);
                entry.result = result;
                entry.status = 'ready';
                entry.applied = paint.applied;
                entry.message = paint.applied + ' balões na imagem';
                entry.notes = [...paint.notes];
                entry.inpaintMetrics = ai?.metrics;
                if (ai?.metrics.patches) entry.message += ' · limpeza LaMa';
                delete entry.forceRender;
                const stored = await renderedCache.put(renderKey, { blob: output, entry: { ...entry, image: null } });
                entry.diskCached = stored;
                if (generation !== epoch || signal.aborted) break;
                releaseDistantImages();
                emit();
            } catch (error) {
                if (generation !== epoch || signal.aborted) {
                    if (state.pages[url] === entry) delete state.pages[url];
                    break;
                }
                update({ status: 'failed', message: error.message });
                // Stop on failure; retry is explicit to avoid repeated API requests.
                break;
            }
        }
    } finally {
        running = false;
        controller = null;
        if (generation !== epoch && state.enabled) void pump();
    }
}
