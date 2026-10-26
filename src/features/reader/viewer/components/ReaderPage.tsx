/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { memo, type SyntheticEvent, useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { usePageTranslation } from '@/features/reader/translation/NativeTranslation.ts';
import { BalloonOverlay, type OriginalSource } from '@/features/reader/translation/BalloonOverlay.tsx';
import type { SpinnerImageProps } from '@/base/components/SpinnerImage.tsx';
import { SpinnerImage } from '@/base/components/SpinnerImage.tsx';
import type { IReaderSettings, ReaderCustomFilter, ReaderPagerProps } from '@/features/reader/Reader.types.ts';
import {
    getImageMarginStyling,
    getImagePlaceholderStyling,
    getReaderImageStyling,
} from '@/features/reader/viewer/pager/ReaderPager.utils.tsx';
import { applyStyles } from '@/base/utils/ApplyStyles.ts';
import { MediaQuery } from '@/base/utils/MediaQuery.tsx';
import type { NavbarContextType } from '@/features/navigation-bar/NavigationBar.types.ts';
import { useReaderScrollbarStore } from '@/features/reader/stores/ReaderStore.ts';
import { ScrollDirection } from '@/base/Base.types.ts';
import { getSafeAreaInsets } from '@/features/reader/settings/ReaderSettings.utils.tsx';

const getCustomFilterString = (customFilter: ReaderCustomFilter): string =>
    Object.keys(customFilter)
        .map((key) => {
            const filter = key as keyof ReaderCustomFilter;
            const value = customFilter[filter];

            switch (filter) {
                case 'brightness':
                case 'contrast':
                case 'saturate':
                    return (value as ReaderCustomFilter['brightness' | 'contrast' | 'saturate']).enabled
                        ? `${filter}(${(value as ReaderCustomFilter['brightness' | 'contrast' | 'saturate']).value / 100})`
                        : '';
                case 'hue':
                    return (value as ReaderCustomFilter['hue']).enabled
                        ? `hue-rotate(${(value as ReaderCustomFilter['brightness' | 'contrast' | 'saturate']).value}deg)`
                        : '';
                case 'rgba':
                    return '';
                case 'sepia':
                case 'grayscale':
                case 'invert':
                    return value ? `${filter}(${Number(value)})` : '';
                default:
                    throw new Error(`Unexpected "CustomFilter" (${filter})`);
            }
        })
        .join(' ');

const BaseReaderPage = ({
    pageIndex,
    pagesIndex,
    isPrimaryPage,
    display,
    doublePage = false,
    position,
    marginTop,
    shouldLoad,
    readingMode,
    customFilter,
    pageScaleMode,
    shouldStretchPage,
    readerWidth,
    safeAreaInset,
    onLoad,
    onError,
    setRef,
    readerNavBarWidth,
    isLoaded,
    ...props
}: Omit<SpinnerImageProps, 'spinnerStyle' | 'imgStyle' | 'onLoad' | 'onError'> &
    Pick<
        IReaderSettings,
        'readingMode' | 'customFilter' | 'pageScaleMode' | 'shouldStretchPage' | 'readerWidth' | 'safeAreaInset'
    > &
    Pick<NavbarContextType, 'readerNavBarWidth'> & {
        pageIndex: number;
        pagesIndex: number;
        isPrimaryPage: boolean;
        display: boolean;
        doublePage?: boolean;
        position?: 'left' | 'right';
        marginTop?: number;
        onLoad: ReaderPagerProps['onLoad'];
        onError: ReaderPagerProps['onError'];
        setRef?: (pagesIndex: number, ref: HTMLElement | null) => void;
        isLoaded?: boolean;
    }) => {
    const { src } = props;
    const translation = usePageTranslation(src, pageIndex);
    const translatedSrc = translation.enabled ? translation.image : null;

    const isTabletWidth = MediaQuery.useIsTabletWidth();
    const scrollbar = useReaderScrollbarStore((state) => state);

    const [isOverlayReady, setIsOverlayReady] = useState(false);

    useEffect(() => {
        setIsOverlayReady(false);
    }, [translatedSrc]);

    const handleLoad = useCallback(
        () => onLoad?.(pagesIndex, src, isPrimaryPage),
        [onLoad, pagesIndex, src, isPrimaryPage],
    );
    const handleError = useCallback(() => onError?.(pageIndex, src), [onError, pageIndex, src]);
    const wrapperRef = useRef<HTMLElement | null>(null);
    // The original page as already loaded by SpinnerImage, reused for "show original".
    const getOriginalSource = useCallback((): OriginalSource | undefined => {
        const image = wrapperRef.current?.querySelector('img');
        return image?.currentSrc
            ? { src: image.currentSrc, crossOrigin: (image.crossOrigin || undefined) as OriginalSource['crossOrigin'] }
            : undefined;
    }, []);
    const updateRef = useCallback(
        (element: HTMLElement | null) => {
            wrapperRef.current = element;
            element?.setAttribute('data-ihc-page', String(pageIndex));
            setRef?.(pagesIndex, element);
        },
        [pagesIndex, pageIndex, setRef],
    );

    if (!display && !shouldLoad) {
        return null;
    }

    // The queue moves a page through loading → ocr → translating → ready.
    const isProcessing = translation.enabled && ['loading', 'ocr', 'translating'].includes(translation.status ?? '');
    const isCurrentPending =
        translation.enabled && !translatedSrc && translation.status !== 'failed' && translation.isCurrent;
    const showLoadingIndicator = display && isLoaded && (isProcessing || isCurrentPending);
    const processingMessage = isProcessing ? translation.message || 'Traduzindo…' : 'Aguardando tradução…';

    const filterString = getCustomFilterString(customFilter);
    const hasBalloons = !!translation.balloons?.length;

    return (
        <Box
            ref={updateRef}
            data-ihc-page={pageIndex}
            // Pages of adjacent chapters are also mounted (preloaded); the source tells them apart.
            data-ihc-src={src}
            sx={{
                position: 'relative',
                display: display ? 'block' : 'none',
                width: 'fit-content',
                height: 'fit-content',
                lineHeight: 0,
                maxWidth: '100%',
                ...getImageMarginStyling(doublePage, position),
                ...applyStyles(marginTop !== undefined, {
                    mt: `${marginTop}px`,
                }),
            }}
        >
            <SpinnerImage
                {...props}
                src={src}
                onLoad={handleLoad}
                onError={handleError}
                shouldLoad={shouldLoad}
                shouldDecode
                spinnerStyle={{
                    backgroundColor: 'background.paper',
                    ...getImagePlaceholderStyling(
                        readingMode,
                        shouldStretchPage,
                        pageScaleMode,
                        readerWidth,
                        [readerNavBarWidth, scrollbar.ySize, ...getSafeAreaInsets(safeAreaInset, ScrollDirection.X)],
                        [scrollbar.xSize, ...getSafeAreaInsets(safeAreaInset, ScrollDirection.Y)],
                        doublePage,
                        isTabletWidth,
                    ),
                    ...applyStyles(!display, {
                        display: 'none',
                    }),
                }}
                imgStyle={{
                    ...getReaderImageStyling(
                        readingMode,
                        shouldStretchPage,
                        pageScaleMode,
                        doublePage,
                        readerWidth,
                        [readerNavBarWidth, scrollbar.ySize, ...getSafeAreaInsets(safeAreaInset, ScrollDirection.X)],
                        [scrollbar.xSize, ...getSafeAreaInsets(safeAreaInset, ScrollDirection.Y)],
                    ),
                    filter: filterString,
                    objectFit: 'contain',
                    objectPosition: position,
                    userSelect: 'none',
                    display: 'block',
                    ...applyStyles(!display, {
                        display: 'none',
                    }),
                }}
                hideImgStyle={{
                    visibility: 'hidden',
                    minWidth: 0,
                    minHeight: 0,
                    width: 0,
                    height: 0,
                }}
            />

            {translatedSrc && (
                <Box
                    component="img"
                    src={translatedSrc}
                    alt={props.alt}
                    draggable={false}
                    // Decode before fading in, off the interface thread for raster images, so the swap from the
                    // original page does not stall scrolling.
                    decoding="async"
                    onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
                        const image = event.currentTarget;
                        image
                            .decode()
                            .catch(() => {})
                            .then(() => {
                                if (image.isConnected && image.src === translatedSrc) {
                                    setIsOverlayReady(true);
                                }
                            });
                    }}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        objectPosition: position,
                        filter: filterString,
                        pointerEvents: 'none',
                        display: 'block',
                        zIndex: 1,
                        opacity: isOverlayReady ? 1 : 0,
                        // With balloon outlines the reveal animates each balloon instead of the whole page.
                        transition: hasBalloons ? 'none' : 'opacity 0.25s ease-in-out',
                    }}
                />
            )}

            {translatedSrc && hasBalloons && (
                <BalloonOverlay
                    key={translatedSrc}
                    balloons={translation.balloons!}
                    ready={isOverlayReady}
                    animate={translation.animate}
                    outline={translation.outline}
                    glows={translation.glows}
                    getOriginalSource={getOriginalSource}
                    imageFilter={filterString}
                />
            )}

            {showLoadingIndicator && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        zIndex: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.25,
                        py: 0.5,
                        borderRadius: '20px',
                        bgcolor: 'rgba(18, 18, 22, 0.85)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.4)',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        transition: 'opacity 0.2s ease-in-out',
                    }}
                >
                    <CircularProgress size={12} thickness={5} sx={{ color: '#64b5f6' }} />
                    <Typography
                        variant="caption"
                        sx={{
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 500,
                            lineHeight: 1,
                            letterSpacing: '0.01em',
                        }}
                    >
                        {processingMessage}
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export const ReaderPage = memo(BaseReaderPage);
