// Test setup for component tests. Loaded by Vitest before each suite.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Auto-cleanup the DOM after each test so state doesn't leak between cases.
afterEach(() => cleanup());

// Stub localStorage for any module that touches it on import.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    key: i => Array.from(store.keys())[i] || null,
    get length() { return store.size; }
  };
}

// Some modules call crypto.randomUUID at the module scope.
if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) {
  let n = 0;
  globalThis.crypto.randomUUID = () => 'uuid-' + (++n);
}
