import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

/*
 * jsdom does not implement these, and Radix primitives (Select, Tooltip,
 * DropdownMenu) call them on mount. Without the stubs every component test
 * fails on an unrelated TypeError.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof globalThis.DOMRect === 'undefined') {
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    top = 0
    left = 0
    right = 0
    bottom = 0
    static fromRect() {
      return new globalThis.DOMRect()
    }
    toJSON() {
      return {}
    }
  } as unknown as typeof DOMRect
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

/*
 * A test that forgets to stub `fetch` should fail loudly and immediately, not
 * hang until the timeout — `onUnhandledRequest: 'error'` in the MSW server
 * catches the request first, and this is the backstop for suites without MSW.
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = (() => Promise.reject(new Error('fetch not stubbed in this test'))) as typeof fetch
}
