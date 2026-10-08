import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useReaderChaptersStore, useReaderPagesStore } from '@/features/reader/stores/ReaderStore.ts';
import { getPage } from '@/features/reader/overlay/progress-bar/ReaderProgressBar.utils.tsx';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { useNativeTranslation } from './NativeTranslation.ts';

export function ReaderTranslation() {
    const { state, module } = useNativeTranslation();
    const currentChapter = useReaderChaptersStore('currentChapter');
    const { pageUrls, currentPageIndex, pages } = useReaderPagesStore('pageUrls', 'currentPageIndex', 'pages');
    const current = getPage(currentPageIndex, pages).primary.index;
    const imageUrls = useMemo(() => pageUrls.map((url) => `${requestManager.getBaseUrl()}${url}`), [pageUrls]);
    const [room, setRoom] = useState(0);
    useEffect(() => {
        if (module) module.configure(String(currentChapter?.id ?? ''), imageUrls, current);
    }, [module, currentChapter?.id, imageUrls, current]);
    useEffect(() => () => module?.dispose(), [module]);
    useEffect(() => {
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const candidates = [...document.querySelectorAll<HTMLElement>('[data-ihc-page]')]
                    .map((el) => el.getBoundingClientRect())
                    .filter((rect) => rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
                const rect = candidates.sort(
                    (a, b) =>
                        Math.abs((a.top + a.bottom) / 2 - window.innerHeight / 2) -
                        Math.abs((b.top + b.bottom) / 2 - window.innerHeight / 2),
                )[0];
                setRoom(Math.max(0, document.documentElement.clientWidth - (rect?.right ?? window.innerWidth) - 24));
            });
        };
        measure();
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', measure, true);
        const observer = new ResizeObserver(measure);
        observer.observe(document.body);
        const timer = window.setInterval(measure, 1000);
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(timer);
            observer.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
        };
    }, []);
    if (!state.showInfo) return null;
    const entry = state.pages[imageUrls[current]],
        compact = room < 180;
    const content = (
        <>
            <Typography variant="subtitle2">Tradução · página {current + 1}</Typography>
            <Typography variant="body2" role="status" aria-live="polite">
                {!state.enabled ? 'Tradução automática desativada' : entry?.message || 'Aguardando imagem'}
            </Typography>
            {entry?.status === 'failed' && (
                <Button size="small" onClick={() => module?.retry()}>
                    Tentar novamente
                </Button>
            )}
            {entry?.status === 'ready' && (
                <Button size="small" onClick={() => module?.retry()}>
                    Atualizar imagem
                </Button>
            )}
            {entry?.result && (
                <>
                    <Typography variant="caption" component="p">
                        {entry.applied} balões na imagem · {entry.result.segments.length} trechos reconhecidos
                    </Typography>
                    {entry.notes
                        ?.filter(([, note]) => note.includes('painel'))
                        .map(([id, note]) => (
                            <Typography key={id} variant="caption" component="p">
                                {note}
                            </Typography>
                        ))}
                    {entry.result.segments.map((segment, index) => (
                        <Box key={index} sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                                {segment.sourceText}
                            </Typography>
                            <Typography variant="body2">
                                {segment.translation || segment.translationError || 'Aguardando tradução'}
                            </Typography>
                        </Box>
                    ))}
                </>
            )}
            {!!entry?.inpaintMetrics?.patches && (
                <Typography variant="caption" component="p">
                    Limpeza com IA: {((entry.inpaintMetrics.elapsedMs || 0) / 1000).toFixed(1)} s ·{' '}
                    {entry.inpaintMetrics.patches} recortes /{' '}
                    {entry.inpaintMetrics.neuralRegions ?? entry.inpaintMetrics.patches} bal?es com IA ?{' '}
                    {entry.inpaintMetrics.localRegions ?? 0} leves ·{' '}
                    {entry.inpaintMetrics.provider === 'webgpu' ? 'WebGPU + WASM' : 'WASM'}
                </Typography>
            )}
            <Typography variant="caption" component="p" sx={{ mt: 1 }}>
                A página atual e as duas seguintes são preparadas enquanto você lê.
            </Typography>
        </>
    );
    return (
        <Box
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            sx={{
                position: 'fixed',
                right: 12,
                top: compact ? 72 : 88,
                width: compact ? 210 : Math.min(room, 260),
                maxHeight: compact ? '40vh' : 'calc(100vh - 112px)',
                overflowY: 'auto',
                overflowWrap: 'anywhere',
                p: 1.5,
                borderRadius: 2,
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 1,
                zIndex: 1,
                pointerEvents: 'auto',
            }}
        >
            {compact ? (
                <details>
                    <summary>
                        Tradução: {entry?.status === 'ready' ? 'pronta' : state.enabled ? 'processando' : 'desativada'}
                    </summary>
                    {content}
                </details>
            ) : (
                content
            )}
        </Box>
    );
}
