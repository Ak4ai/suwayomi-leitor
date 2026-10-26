import { ChapterEngine, ChapterCache } from './chapter-engine.js';
import { loadPreferences, savePreferences } from './chapter-preferences.js';
import { listGeminiModels } from './translation.js';
import { isDistant, nextPage } from './native-queue.js';
const renderedCache = new ChapterCache(0);
// Bump whenever the drawn output changes (lettering, SVG, balloon data or highlight); otherwise pages
// already opened keep coming from IndexedDB with the old drawing. v9: glow as one sprite per balloon.
const RENDER_CACHE = 'native-render-v9:';
const listeners = new Set();
let sessionPreferences = loadPreferences();
const saved = (() => {
    try {
        return JSON.parse(localStorage.getItem('ihc-native-reader') || '{}');
    } catch {
        return {};
    }
})();
let state = {
    enabled: !!saved.enabled,
    showInfo: !!saved.showInfo,
    // Reader effects, on unless turned off: balloon reveal animation and outline.
    animate: saved.animate !== false,
    outline: saved.outline !== false,
    pages: {},
    current: 0,
};
// Pages on or near the screen, reported by the reader. Continuous/webtoon
// modes show several pages at once and "current" only changes when a page
// reaches the top, so the window must follow what is actually visible.
let nearby = [0, 0];
let urls = [],
    chapter = '',
    generation = 0,
    running = false,
    controller = null,
    engine = new ChapterEngine(),
    renderer = null,
    renderOnPage = null;
// Page records are replaced, never mutated, so each reader page can
// subscribe to its own record and skip re-rendering for other pages.
const setPage = (url, patch) => (state.pages[url] = { ...state.pages[url], ...patch });
// The snapshot updates immediately; React is notified at most every 50 ms,
// so bursts of progress messages cause one render instead of many.
let notifyTimer = 0;
const emit = () => {
    state = { ...state, pages: { ...state.pages } };
    notifyTimer ||= setTimeout(() => {
        notifyTimer = 0;
        for (const fn of listeners) fn();
    }, 50);
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
        localStorage.setItem(
            'ihc-native-reader',
            JSON.stringify({
                enabled: state.enabled,
                showInfo: state.showInfo,
                animate: state.animate,
                outline: state.outline,
            }),
        );
    } catch {}
};
const stop = () => {
    generation++;
    controller?.abort();
    controller = null;
    engine.stop();
    renderer?.terminate();
    renderer = null;
    renderOnPage?.then((module) => module.stopRender());
};
const clear = () => {
    for (const p of Object.values(state.pages)) revokeImages(p);
    state.pages = {};
};
export function toggle(key, value) {
    state[key] = value;
    save();
    if (key === 'enabled' && !value) stop();
    emit();
    void pump();
}
export function configure(id, pageUrls, current, visible = [current, current]) {
    if (chapter !== id) {
        stop();
        clear();
        chapter = id;
    }
    urls = pageUrls;
    state.current = Math.max(0, Math.min(current, Math.max(0, urls.length - 1)));
    nearby = [Math.min(state.current, visible[0]), Math.max(state.current, visible[1])];
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
    if (p) revokeImages(p);
    state.pages[urls[state.current]] = { index: state.current, status: 'retry', forceRender: true };
    emit();
    void pump();
}
const revokeImages = (p) => {
    if (p.image) URL.revokeObjectURL(p.image);
    for (const glow of p.glows ?? [])
        for (const sprite of [glow.translated, glow.original]) if (sprite?.url) URL.revokeObjectURL(sprite.url);
};
// Glow sprites as stored (blobs) to what the reader shows (object URLs).
const glowUrls = (glows) =>
    glows?.map(({ id, translated, original }) => {
        const toUrl = (sprite) => sprite && { url: URL.createObjectURL(sprite.blob), rect: sprite.rect };
        return { id, translated: toUrl(translated), original: toUrl(original) };
    }) ?? null;
// Keep completion records so evicted pages are not repeatedly queued.
function releaseDistantImages() {
    for (const [url, p] of Object.entries(state.pages))
        if (p.image && isDistant(p.index, nearby, urls.length)) {
            revokeImages(p);
            setPage(url, { image: null, glows: null, result: null });
        }
}
// Cleanup, lettering and PNG/SVG encoding take hundreds of milliseconds per
// page. They run in a worker; browsers without OffscreenCanvas or FontFace
// in workers render on the page instead.
function renderOffThread(blob, segments, options, signal, onProgress) {
    if (renderOnPage)
        return renderOnPage.then((module) => module.renderPage(blob, segments, options, { signal, onProgress }));
    renderer ??= new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
    const worker = renderer;
    return new Promise((resolve, reject) => {
        const finish = (fn, value) => {
            signal.removeEventListener('abort', abort);
            worker.onmessage = null;
            worker.onerror = null;
            fn(value);
        };
        const abort = () => finish(reject, new DOMException('Cancelado', 'AbortError'));
        const discard = () => {
            if (renderer === worker) renderer = null;
            worker.terminate();
        };
        signal.addEventListener('abort', abort, { once: true });
        worker.onerror = (event) => {
            discard();
            finish(reject, new Error(event.message || 'Falha no worker de desenho.'));
        };
        worker.onmessage = ({ data }) => {
            if (data.type === 'progress') onProgress(data.message);
            if (data.type === 'result') finish(resolve, data.result);
            if (data.type === 'error') finish(reject, new Error(data.message));
            if (data.type === 'unsupported') {
                discard();
                renderOnPage = import('./page-render.js');
                finish(resolve, renderOffThread(blob, segments, options, signal, onProgress));
            }
        };
        worker.postMessage({ blob, segments, options });
    });
}
async function pump() {
    if (running || !state.enabled || !urls.length) return;
    running = true;
    const epoch = generation;
    try {
        while (state.enabled && generation === epoch) {
            const index = nextPage(state.pages, urls, state.current, nearby);
            if (index === undefined) break;
            const url = urls[index],
                run = {};
            state.pages[url] = {
                index,
                run,
                forceRender: state.pages[url]?.forceRender,
                status: 'loading',
                message: 'Carregando imagem',
                image: null,
                glows: null,
                applied: 0,
                result: null,
            };
            emit();
            controller = new AbortController();
            const signal = controller.signal;
            const current = () => generation === epoch && !signal.aborted && state.pages[url]?.run === run;
            const update = (patch) => {
                if (!current()) return;
                setPage(url, patch);
                emit();
            };
            try {
                const preferences = { ...sessionPreferences },
                    provider = preferences.provider || 'google';
                if (provider === 'gemini' && (!preferences.key || !preferences.model))
                    throw Error('Configure a chave e o modelo Gemini nas configurações da tradução.');
                const renderKey =
                    RENDER_CACHE +
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
                const cachedRender = state.pages[url].forceRender ? null : await renderedCache.get(renderKey);
                signal.throwIfAborted();
                if (cachedRender?.blob) {
                    if (!current()) break;
                    setPage(url, {
                        ...cachedRender.entry,
                        run,
                        diskCached: true,
                        image: URL.createObjectURL(cachedRender.blob),
                        glows: glowUrls(cachedRender.glows),
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
                        // Leave cores for the interface and image decoding.
                        threads: (navigator.hardwareConcurrency || 4) >= 8 ? 4 : 2,
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
                if (!current()) break;
                update({ message: 'Desenhando tradução…' });
                const painted = await renderOffThread(
                    blob,
                    result.segments,
                    {
                        renderer: preferences.renderer,
                        inpaint: preferences.inpaint,
                        inpaintDevice: preferences.inpaintDevice,
                    },
                    signal,
                    (message) => update({ message }),
                );
                if (!current()) break;
                const done = {
                    status: 'ready',
                    result,
                    applied: painted.applied,
                    message:
                        painted.applied +
                        ' balões na imagem' +
                        (painted.inpaintMetrics?.patches ? ' · limpeza LaMa' : ''),
                    notes: painted.notes,
                    balloons: painted.balloons,
                    inpaintMetrics: painted.inpaintMetrics,
                    forceRender: undefined,
                };
                const entry = { ...state.pages[url], ...done, image: null, glows: null };
                delete entry.run;
                const diskCached = await renderedCache.put(renderKey, {
                    blob: painted.blob,
                    glows: painted.glows,
                    entry,
                });
                if (!current()) break;
                setPage(url, {
                    ...done,
                    diskCached,
                    image: URL.createObjectURL(painted.blob),
                    glows: glowUrls(painted.glows),
                });
                releaseDistantImages();
                emit();
            } catch (error) {
                if (generation !== epoch || signal.aborted) {
                    if (state.pages[url]?.run === run) delete state.pages[url];
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
