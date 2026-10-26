/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
export interface TranslationPage {
    index: number;
    status: string;
    message: string;
    image: string | null;
    // Soft glow around the text of each redrawn balloon (one small image each, placed by rect).
    glows?: BalloonGlow[] | null;
    applied: number;
    // Interior outline of each redrawn balloon, normalised to the page (0–1).
    balloons?: TranslatedBalloon[];
    notes?: [string, string][];
    inpaintMetrics?: {
        elapsedMs?: number;
        inferenceMs?: number;
        initializationMs?: number;
        patches: number;
        localRegions?: number;
        neuralRegions?: number;
        provider?: string;
        modelBytes?: number;
    };
    result?: { segments: { sourceText: string; translation: string; translationError?: string }[] } | null;
}
export interface GlowSprite {
    url: string;
    // Place on the page, normalised [x, y, width, height].
    rect: [number, number, number, number];
}
export interface BalloonGlow {
    id: string;
    translated: GlowSprite | null;
    original: GlowSprite | null;
}
export interface TranslatedBalloon {
    id: string;
    outline: [number, number][];
    // Laid out text, normalised [x0, y0, x1, y1]: area of the highlight border.
    textBox?: [number, number, number, number];
    // Original text (OCR lines), normalised [x0, y0, x1, y1]: area of the glow while the original is shown.
    sourceBox?: [number, number, number, number];
}
export interface TranslationState {
    enabled: boolean;
    showInfo: boolean;
    animate: boolean;
    outline: boolean;
    current: number;
    pages: Record<string, TranslationPage>;
}
// svg-light: JPEG background and shared glyph outlines, much lighter to display.
export type TranslationRenderer = 'canvas' | 'svg' | 'svg-light';
export interface TranslationPreferences {
    opusVariant?: 'compact' | 'big';
    opusNormalize?: boolean;
    provider?: string;
    key?: string;
    model?: string;
    mode?: string;
    rememberKey?: boolean;
    renderer?: TranslationRenderer;
    inpaint?: 'local' | 'hybrid' | 'ai';
    inpaintDevice?: 'auto' | 'wasm';
}
interface TranslationModule {
    subscribe: (fn: () => void) => () => void;
    getSnapshot: () => TranslationState;
    configure: (id: string, urls: string[], current: number, visible?: [number, number]) => void;
    dispose: () => void;
    toggle: (key: TranslationFlag, value: boolean) => void;
    retry: () => void;
    getPreferences: () => TranslationPreferences;
    setPreferences: (patch: TranslationPreferences) => void;
    getModels: (key: string) => Promise<{ id: string; label: string }[]>;
}
export type TranslationFlag = 'enabled' | 'showInfo' | 'animate' | 'outline';
const empty: TranslationState = {
    enabled: false,
    showInfo: false,
    animate: true,
    outline: true,
    current: 0,
    pages: {},
};
let api: TranslationModule | null = null;
// Public assets must be loaded as browser modules, outside Vite's source
// import pipeline. The entry script delivers its API through a DOM event.
const loading = new Promise<TranslationModule>((resolve, reject) => {
    const cached = (window as Window & { ihcNativeReaderApi?: TranslationModule }).ihcNativeReaderApi;
    if (cached) {
        api = cached;
        resolve(cached);
        return;
    }
    const script = document.createElement('script');
    const ready = (event: Event) => {
        window.removeEventListener('ihc-native-reader-ready', ready);
        api = (event as CustomEvent<TranslationModule>).detail;
        resolve(api);
    };
    window.addEventListener('ihc-native-reader-ready', ready);
    script.type = 'module';
    script.src = new URL('ocr-web/native-entry.js', document.baseURI).href;
    script.onerror = () => {
        window.removeEventListener('ihc-native-reader-ready', ready);
        reject(new Error('Não foi possível carregar os recursos da tradução.'));
    };
    document.head.append(script);
});
const noopSubscribe = () => () => {};
function useTranslationModule() {
    const [module, setModule] = useState(api);
    const [error, setError] = useState('');
    useEffect(() => {
        let mounted = true;
        loading
            .then((value) => {
                if (mounted) {
                    setModule(value);
                    setError('');
                }
            })
            .catch((reason) => {
                if (mounted) {
                    setError(String(reason));
                }
            });
        return () => {
            mounted = false;
        };
    }, []);
    return { module, error };
}
// The selector must return a primitive or a stable reference: components
// re-render only when it changes, not on every progress message.
export function useNativeTranslation<T = TranslationState>(
    select: (state: TranslationState) => T = (state) => state as T,
) {
    const { module, error } = useTranslationModule();
    const getSelected = useCallback(() => select(module?.getSnapshot() ?? empty), [module, select]);
    const state = useSyncExternalStore(module?.subscribe || noopSubscribe, getSelected);
    return { state, module, error };
}
// Panel state only while the panel is open.
export const selectWhenInfoShown = (state: TranslationState) => (state.showInfo ? state : empty);
export const selectFlags = (state: TranslationState) =>
    `${state.enabled}:${state.showInfo}:${state.animate}:${state.outline}`;
export interface PageTranslation {
    enabled: boolean;
    status?: string;
    message?: string;
    image: string | null;
    glows?: BalloonGlow[];
    isCurrent: boolean;
    animate: boolean;
    outline: boolean;
    balloons?: TranslatedBalloon[];
}
// Only this page's fields. The queue emits for every progress message of
// any page; with the whole state, every page in the reader re-rendered.
export function usePageTranslation(src: string, pageIndex: number): PageTranslation {
    const { module } = useTranslationModule();
    const getKey = useCallback(() => {
        const state = module?.getSnapshot() ?? empty;
        const page = state.enabled ? state.pages[src] : undefined;
        return JSON.stringify([
            state.enabled,
            page?.status,
            page?.message,
            page?.image ?? null,
            state.current === pageIndex,
            state.animate,
            state.outline,
        ]);
    }, [module, src, pageIndex]);
    const key = useSyncExternalStore(module?.subscribe || noopSubscribe, getKey);
    // Records are replaced, not mutated, so the array reference is stable.
    const getBalloons = useCallback(() => (module?.getSnapshot() ?? empty).pages[src]?.balloons, [module, src]);
    const balloons = useSyncExternalStore(module?.subscribe || noopSubscribe, getBalloons);
    const getGlows = useCallback(() => (module?.getSnapshot() ?? empty).pages[src]?.glows ?? undefined, [module, src]);
    const glows = useSyncExternalStore(module?.subscribe || noopSubscribe, getGlows);
    return useMemo(() => {
        const [enabled, status, message, image, isCurrent, animate, outline] = JSON.parse(key);
        return {
            enabled,
            status: status ?? undefined,
            message: message ?? undefined,
            image,
            isCurrent,
            animate,
            outline,
            balloons,
            glows,
        };
    }, [key, balloons, glows]);
}
