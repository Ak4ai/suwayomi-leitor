import * as api from './native-reader.js';

window.ihcNativeReaderApi = api;
window.dispatchEvent(new CustomEvent('ihc-native-reader-ready', { detail: api }));
