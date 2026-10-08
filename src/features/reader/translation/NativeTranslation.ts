import { useEffect, useState, useSyncExternalStore } from 'react';
export interface TranslationPage {
    index: number;
    status: string;
    message: string;
    image: string | null;
    applied: number;
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
export interface TranslationState {
    enabled: boolean;
    showInfo: boolean;
    current: number;
    pages: Record<string, TranslationPage>;
}
export interface TranslationPreferences {
    opusVariant?: 'compact' | 'big';
    opusNormalize?: boolean;
    provider?: string;
    key?: string;
    model?: string;
    mode?: string;
    rememberKey?: boolean;
    renderer?: 'canvas' | 'svg';
    inpaint?: 'local' | 'hybrid' | 'ai';
    inpaintDevice?: 'auto' | 'wasm';
}
interface TranslationModule {
    subscribe: (fn: () => void) => () => void;
    getSnapshot: () => TranslationState;
    configure: (id: string, urls: string[], current: number) => void;
    dispose: () => void;
    toggle: (key: 'enabled' | 'showInfo', value: boolean) => void;
    retry: () => void;
    getPreferences: () => TranslationPreferences;
    setPreferences: (patch: TranslationPreferences) => void;
    getModels: (key: string) => Promise<{ id: string; label: string }[]>;
}
const empty: TranslationState = { enabled: false, showInfo: false, current: 0, pages: {} };
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
export function useNativeTranslation() {
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
                if (mounted) setError(String(reason));
            });
        return () => {
            mounted = false;
        };
    }, []);
    const state = useSyncExternalStore(module?.subscribe || noopSubscribe, module?.getSnapshot || (() => empty));
    return { state, module, error };
}
