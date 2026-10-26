import assert from 'node:assert/strict';
import { isDistant, nextPage, renderWindow } from '../public/ocr-web/native-queue.js';

const urls = Array.from({ length: 20 }, (_, i) => `p${i}`);
const ready = (indices, image = 'blob:x') =>
    Object.fromEntries(indices.map((i) => [urls[i], { index: i, status: 'ready', image }]));

// Webtoon: current page 3 at the top, page 4 entering at the bottom.
assert.equal(nextPage(ready([3]), urls, 3, [3, 4]), 4);
// A released image entering the screen is restored before it becomes current.
assert.equal(nextPage({ ...ready([3]), ...ready([4], null) }, urls, 3, [3, 4]), 4);
// Nothing beyond two pages after the visible range is processed.
assert.equal(nextPage(ready([2, 3, 4, 5, 6]), urls, 3, [3, 4]), undefined);
// The previous page comes after the pages ahead, but inside the window.
assert.equal(nextPage(ready([3, 4, 5, 6]), urls, 3, [3, 4]), 2);
// Failed pages are not retried automatically; explicit retries are.
assert.equal(nextPage({ ...ready([3]), p4: { status: 'failed' } }, urls, 3, [3, 3]), 5);
assert.equal(nextPage({ ...ready([3]), p4: { status: 'retry' } }, urls, 3, [3, 3]), 4);
// Window is clamped to the chapter.
assert.deepEqual(renderWindow([0, 19], 20), [0, 19]);
// Images stay while near the window; far ones are released.
assert.equal(isDistant(7, [3, 4], 20), false);
assert.equal(isDistant(9, [3, 4], 20), true);
assert.equal(isDistant(0, [3, 4], 20), false);
console.log(JSON.stringify({ passed: true }));
