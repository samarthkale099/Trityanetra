import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Existing tests were written against the jest API; expose `vi` as `jest`
// so jest.fn / jest.clearAllMocks / jest.spyOn keep working under vitest.
(globalThis as any).jest = vi;

// --- jsdom polyfills required by the exam tests -------------------------

// jsdom does not implement ClipboardEvent; paste tests construct it directly.
if (typeof (globalThis as any).ClipboardEvent === 'undefined') {
  class ClipboardEventPolyfill extends Event {
    clipboardData: DataTransfer | null;
    constructor(type: string, params: ClipboardEventInit = {}) {
      super(type, params);
      this.clipboardData = params.clipboardData ?? null;
    }
  }
  (globalThis as any).ClipboardEvent = ClipboardEventPolyfill;
}

// jsdom does not implement layout APIs on Range; CodeMirror 6 calls them
// during measurement (getClientRects / getBoundingClientRect).
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = function getClientRects(): DOMRectList {
    const empty = [] as any;
    empty.item = (index: number) => null;
    return empty;
  } as any;
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
if (typeof Element.prototype.getClientRects !== 'function') {
  Element.prototype.getClientRects = function getClientRects(): HTMLCollection {
    return document.createElement('div').children;
  } as any;
}

// Mock window.confirm globally
Object.defineProperty(window, 'confirm', {
  writable: true,
  value: vi.fn(() => true),
});

// Mock window.alert
Object.defineProperty(window, 'alert', {
  writable: true,
  value: vi.fn(),
});
