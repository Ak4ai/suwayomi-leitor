/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { type KeyboardEvent, type SyntheticEvent, useEffect, useRef, useState } from 'react';
import type { BalloonGlow, TranslatedBalloon } from '@/features/reader/translation/NativeTranslation.ts';

const STAGGER_MS = 140;
const FADE_MS = 550;
const TOGGLE_MS = 300;

const toPath = (outline: [number, number][]) => `M${outline.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
const toPolygon = (outline: [number, number][]) =>
    `polygon(${outline.map(([x, y]) => `${+(x * 100).toFixed(2)}% ${+(y * 100).toFixed(2)}%`).join(',')})`;

export interface OriginalSource {
    src: string;
    crossOrigin?: 'anonymous' | 'use-credentials' | '';
}
const top = (balloon: TranslatedBalloon) => Math.min(...balloon.outline.map(([, y]) => y));
const left = (balloon: TranslatedBalloon) => Math.min(...balloon.outline.map(([x]) => x));
const stop = (event: SyntheticEvent) => event.stopPropagation();
// The original page, decoded, so its layer is ready before a fade starts; undefined if not available.
const decodedOriginal = async (source: OriginalSource | undefined) => {
    if (!source) {
        return undefined;
    }
    const image = new Image();
    if (source.crossOrigin !== undefined) {
        image.crossOrigin = source.crossOrigin;
    }
    image.src = source.src;
    try {
        await image.decode();
        return source;
    } catch {
        return undefined;
    }
};

type Phase = 'original' | 'reveal' | 'idle';

/**
 * Layer over a translated page. No new images are rendered: showing the original text clips the
 * already loaded original page (same request, served from the image cache) to the balloon outline.
 * - reveal: every time the page comes into view, each balloon crossfades from the original, in reading
 *   order. The reader's own switch decides, not the system "reduce motion" preference: it was asked for
 *   explicitly, and Windows turns that preference on whenever "Animation effects" is off;
 * - outline: soft diffuse glow around the text block (rendered with the page by balloon-glow.js, like a smoothed
 *   selection), one for the translated and one for the original text, clipped per balloon so each one reacts to
 *   hover and to the original/translation state;
 * - click / Enter: toggles one balloon between original and translation.
 */
export function BalloonOverlay({
    balloons,
    ready,
    animate,
    outline,
    getOriginalSource,
    imageFilter,
    glows,
}: {
    balloons: TranslatedBalloon[];
    ready: boolean;
    animate: boolean;
    outline: boolean;
    getOriginalSource: () => OriginalSource | undefined;
    imageFilter?: string;
    glows?: BalloonGlow[];
}) {
    const ref = useRef<SVGSVGElement>(null);
    // Starts on the original so the page never flashes translated before the reveal.
    const [phase, setPhase] = useState<Phase>(() => (animate ? 'original' : 'idle'));
    const [original, setOriginal] = useState<ReadonlySet<string>>(new Set());
    const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
    const [originalSource, setOriginalSource] = useState(getOriginalSource);
    // Bumped when the page leaves the screen, cancelling a reveal that is still waiting for the original.
    const revealToken = useRef(0);
    const [hovered, setHovered] = useState<string | null>(null);
    const glowById = new Map(glows?.map((glow) => [glow.id, glow]));

    useEffect(() => {
        if (!animate) {
            setPhase('idle');
        }
    }, [animate]);

    // The reader may still be loading the original page (the translation comes from cache in
    // milliseconds), or may have replaced its URL after unloading a distant page. So the source is
    // read again every time the page appears, decoded, and only then the reveal starts; with no
    // original after a few seconds, the translation is shown without it.
    const startReveal = (token: number, attempt = 0): void => {
        void decodedOriginal(getOriginalSource()).then((source) => {
            if (token !== revealToken.current) {
                return;
            }
            if (source) {
                setOriginalSource(source);
                // Two frames: the original layers are mounted and painted opaque before fading.
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        if (token === revealToken.current) {
                            setPhase((current) => (current === 'original' ? 'reveal' : current));
                        }
                    }),
                );
            } else if (attempt < 30) {
                window.setTimeout(() => startReveal(token, attempt + 1), 200);
            } else {
                setPhase((current) => (current === 'original' ? 'idle' : current));
            }
        });
    };

    // Reveal once the translated image is shown and the page is well on screen. When the page leaves
    // the screen entirely (scrolled away in webtoon, hidden on a page change in single page), go back
    // to the original so the reveal plays again next time it appears.
    useEffect(() => {
        if (!animate || !ready || !ref.current) {
            return undefined;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry) {
                    return;
                }
                if (!entry.isIntersecting) {
                    revealToken.current++;
                    setPhase('original');
                    setOriginal(new Set());
                    return;
                }
                // A third of the page, or half of the screen for pages taller than the viewport (webtoon).
                const needed = Math.min(entry.boundingClientRect.height / 3, window.innerHeight / 2);
                if (entry.intersectionRect.height >= needed) {
                    revealToken.current++;
                    startReveal(revealToken.current);
                }
            },
            { threshold: Array.from({ length: 21 }, (_, index) => index / 20) },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [animate, ready]);

    useEffect(() => {
        if (phase !== 'reveal') {
            return undefined;
        }
        const timer = window.setTimeout(() => setPhase('idle'), FADE_MS + STAGGER_MS * balloons.length + 50);
        return () => clearTimeout(timer);
    }, [phase, balloons.length]);

    // Reading order: top to bottom, then left to right.
    const order = new Map(
        [...balloons]
            .sort((a, b) => (Math.abs(top(a) - top(b)) > 0.03 ? top(a) - top(b) : left(a) - left(b)))
            .map((balloon, index) => [balloon.id, index]),
    );

    const toggle = (id: string) => {
        const flip = () =>
            setOriginal((current) => {
                const next = new Set(current);
                if (!next.delete(id)) {
                    next.add(id);
                }
                return next;
            });
        if (touched.has(id)) {
            flip();
            return;
        }
        // First click: mount the original layer transparent, then fade it in on a later frame. Mounting it
        // already opaque would skip the transition.
        setOriginalSource((current) => getOriginalSource() ?? current);
        setTouched((current) => new Set(current).add(id));
        requestAnimationFrame(() => requestAnimationFrame(flip));
    };

    const states = balloons.map((balloon) => ({
        balloon,
        showOriginal: phase === 'original' || (phase === 'idle' && original.has(balloon.id)),
        mounted: phase !== 'idle' || touched.has(balloon.id),
        transition:
            phase === 'reveal'
                ? `opacity ${FADE_MS}ms ease-in-out ${(order.get(balloon.id) ?? 0) * STAGGER_MS}ms`
                : `opacity ${TOGGLE_MS}ms ease-in-out`,
    }));

    return (
        <>
            {/* Same URL and CORS mode as the reader's <img>, so it comes from the image cache. An SVG <image>
                makes a different request, which cross-origin isolation blocks when the API is on another origin. */}
            {originalSource &&
                states.map(
                    ({ balloon, showOriginal, mounted, transition }) =>
                        mounted && (
                            <img
                                key={balloon.id}
                                src={originalSource.src}
                                crossOrigin={originalSource.crossOrigin}
                                alt=""
                                aria-hidden
                                draggable={false}
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: '100%',
                                    height: '100%',
                                    zIndex: 2,
                                    pointerEvents: 'none',
                                    filter: imageFilter,
                                    clipPath: toPolygon(balloon.outline),
                                    opacity: showOriginal ? 1 : 0,
                                    transition,
                                }}
                            />
                        ),
                )}
            {/* Glow appears after the reveal. Each balloon has one around the translated text and one (amber)
                around the original text; toggling crossfades them, so the glow fits the text on screen. Each is
                its own small image placed at its rect, so nothing is clipped. */}
            {states.flatMap(({ balloon }) => {
                const glow = glowById.get(balloon.id);
                if (!glow) {
                    return [];
                }
                const shown = outline && phase === 'idle',
                    strength = hovered === balloon.id ? 1 : 0.75,
                    isOriginal = original.has(balloon.id),
                    layers = [
                        { key: 'translated', sprite: glow.translated, visible: !isOriginal || !glow.original },
                        { key: 'original', sprite: glow.original, visible: isOriginal },
                    ];
                return layers.map(
                    ({ key, sprite, visible }) =>
                        sprite && (
                            <img
                                key={`glow-${key}-${balloon.id}`}
                                src={sprite.url}
                                alt=""
                                aria-hidden
                                draggable={false}
                                style={{
                                    position: 'absolute',
                                    left: `${sprite.rect[0] * 100}%`,
                                    top: `${sprite.rect[1] * 100}%`,
                                    width: `${sprite.rect[2] * 100}%`,
                                    height: `${sprite.rect[3] * 100}%`,
                                    maxWidth: 'none',
                                    zIndex: 2,
                                    pointerEvents: 'none',
                                    opacity: shown && visible ? strength : 0,
                                    filter: isOriginal ? 'hue-rotate(-170deg) saturate(1.4)' : 'none',
                                    transition: `opacity ${TOGGLE_MS}ms ease-in-out, filter ${TOGGLE_MS}ms ease`,
                                }}
                            />
                        ),
                );
            })}
            <svg
                ref={ref}
                data-phase={phase}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 2,
                    pointerEvents: 'none',
                }}
            >
                {states.map(({ balloon }) => (
                    <path
                        key={balloon.id}
                        d={toPath(balloon.outline)}
                        role="button"
                        tabIndex={0}
                        aria-pressed={original.has(balloon.id)}
                        aria-label={original.has(balloon.id) ? 'Mostrar tradução' : 'Mostrar texto original'}
                        className="ihc-balloon"
                        data-outline={outline}
                        data-original={original.has(balloon.id)}
                        data-revealing={phase !== 'idle'}
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: 'visiblePainted', cursor: 'pointer' }}
                        onPointerDown={stop}
                        onPointerEnter={() => setHovered(balloon.id)}
                        onPointerLeave={() => setHovered((current) => (current === balloon.id ? null : current))}
                        onClick={(event) => {
                            stop(event);
                            toggle(balloon.id);
                        }}
                        onKeyDown={(event: KeyboardEvent) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggle(balloon.id);
                            }
                        }}
                    />
                ))}
                <style>{`
                    .ihc-balloon { fill: transparent; stroke: transparent; stroke-width: 2px; outline: none; }
                    /* The glow marks balloons; a ring only for keyboard focus, so it stays visible. */
                    .ihc-balloon:focus-visible { stroke: rgba(100, 181, 246, 0.95); }
                    .ihc-balloon[data-original="true"]:focus-visible { stroke: rgba(255, 183, 77, 0.95); }
                `}</style>
            </svg>
        </>
    );
}
