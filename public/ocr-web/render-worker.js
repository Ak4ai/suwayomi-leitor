// Draws translated pages off the interface thread. LaMa runs in a nested
// worker started by AIInpainter. Terminating this worker cancels both.
const module =
    typeof OffscreenCanvas !== 'undefined' && typeof FontFace !== 'undefined' && self.fonts
        ? import('./page-render.js').catch(() => null)
        : Promise.resolve(null);
self.onmessage = async ({ data }) => {
    const render = await module;
    // The reader falls back to rendering on the page.
    if (!render) return self.postMessage({ type: 'unsupported' });
    try {
        const result = await render.renderPage(data.blob, data.segments, data.options, {
            onProgress: (message) => self.postMessage({ type: 'progress', message }),
        });
        self.postMessage({ type: 'result', result });
    } catch (error) {
        self.postMessage({ type: 'error', message: error?.message || String(error) });
    }
};
