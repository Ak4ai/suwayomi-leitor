/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useReaderChaptersStore, useReaderPagesStore } from '@/features/reader/stores/ReaderStore.ts';
import { getPage } from '@/features/reader/overlay/progress-bar/ReaderProgressBar.utils.tsx';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { selectWhenInfoShown, useNativeTranslation } from '@/features/reader/translation/NativeTranslation.ts';

export function ReaderTranslation() {
    const { state, module } = useNativeTranslation(selectWhenInfoShown);
    const currentChapter = useReaderChaptersStore('currentChapter');
    const { pageUrls, currentPageIndex, pages } = useReaderPagesStore('pageUrls', 'currentPageIndex', 'pages');
    const current = getPage(currentPageIndex, pages).primary.index;
    const imageUrls = useMemo(() => pageUrls.map((url) => `${requestManager.getBaseUrl()}${url}`), [pageUrls]);
    const [room, setRoom] = useState(0);
    // Read by the measure loop, which is set up once.
    const imageUrlsRef = useRef(imageUrls);
    imageUrlsRef.current = imageUrls;
    // First and last page on or within half a screen of the viewport. A page starts translating as it approaches
    // the bottom edge, not only when the reader marks it as current (top edge in continuous/webtoon modes).
    const [nearby, setNearby] = useState<[number, number]>([current, current]);
    const [nearFirst, nearLast] = nearby;
    useEffect(() => {
        if (module) {
            module.configure(String(currentChapter?.id ?? ''), imageUrls, current, [
                Math.min(current, nearFirst),
                Math.max(current, nearLast),
            ]);
        }
    }, [module, currentChapter?.id, imageUrls, current, nearFirst, nearLast]);
    useEffect(() => () => module?.dispose(), [module]);
    useEffect(() => {
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                // Only this chapter's pages: the reader also mounts pages of adjacent chapters, whose indices
                // (e.g. 122 of the previous chapter) would stretch the queue window over the whole chapter.
                const pageElements = [...document.querySelectorAll<HTMLElement>('[data-ihc-page]')].filter(
                    (el) => imageUrlsRef.current[Number(el.dataset.ihcPage)] === el.dataset.ihcSrc,
                );
                const marginX = window.innerWidth / 2;
                const marginY = window.innerHeight / 2;
                const near = pageElements
                    .filter((el) => {
                        const rect = el.getBoundingClientRect();
                        return (
                            rect.width > 0 &&
                            rect.height > 0 &&
                            rect.bottom > -marginY &&
                            rect.top < window.innerHeight + marginY &&
                            rect.right > -marginX &&
                            rect.left < window.innerWidth + marginX
                        );
                    })
                    .map((el) => Number(el.dataset.ihcPage))
                    .filter(Number.isFinite);
                if (near.length) {
                    const range: [number, number] = [Math.min(...near), Math.max(...near)];
                    setNearby((previous) => (previous[0] === range[0] && previous[1] === range[1] ? previous : range));
                }
                const candidates = pageElements
                    .map((el) => el.getBoundingClientRect())
                    .filter((rect) => rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
                const [rect] = candidates.sort(
                    (a, b) =>
                        Math.abs((a.top + a.bottom) / 2 - window.innerHeight / 2) -
                        Math.abs((b.top + b.bottom) / 2 - window.innerHeight / 2),
                );
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
    if (!state.showInfo) {
        return null;
    }
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
                        // Segments have no id; the list is replaced as a whole, never reordered.
                        // oxlint-disable-next-line react/no-array-index-key
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
                As páginas na tela e as duas seguintes são preparadas enquanto você lê.
            </Typography>
        </>
    );
    let statusLabel = 'desativada';
    if (entry?.status === 'ready') {
        statusLabel = 'pronta';
    } else if (state.enabled) {
        statusLabel = 'processando';
    }
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
                    <summary>Tradução: {statusLabel}</summary>
                    {content}
                </details>
            ) : (
                content
            )}
        </Box>
    );
}
