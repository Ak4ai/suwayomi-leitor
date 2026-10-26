// Which reader pages to render, given the current page and the range of pages
// on or near the screen. Pure functions; native-reader.js owns the state.

// From one page before the visible range to two pages after it.
export const renderWindow = (nearby, total) => [Math.max(0, nearby[0] - 1), Math.min(total - 1, nearby[1] + 2)];

// Reading order inside the window: current page, the pages after it
// (including one just entering the screen), then the pages before it.
// Released images in the window are restored before new work further away.
export function nextPage(pages, urls, current, nearby) {
    const [start, end] = renderWindow(nearby, urls.length);
    const candidates = [
        current,
        ...Array.from({ length: Math.max(0, end - current) }, (_, i) => current + i + 1),
        ...Array.from({ length: Math.max(0, current - start) }, (_, i) => current - i - 1),
    ];
    return candidates.find((n) => {
        const page = pages[urls[n]];
        return !page || page.status === 'retry' || (page.status === 'ready' && !page.image);
    });
}

// Images are kept a little beyond the window so small scrolls back and forth
// do not re-render pages.
export function isDistant(index, nearby, total) {
    const [start, end] = renderWindow(nearby, total);
    return index < start - 2 || index > end + 2;
}
