import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

// Make console.error and console.warn throw so that React warnings and
// component misuse surface as test failures rather than silent stderr noise.
// Tests that need to assert on intentional warnings can mock console locally.
//
// Why accumulate errors before throwing: React 19 concurrent rendering calls
// console.error twice when something goes wrong — first with the specific
// message (e.g. "Each child in a list should have a unique key prop") and then
// with a generic "There was an error during concurrent rendering" recovery
// message. React catches the first throw internally, so only the second throw
// propagates. By accumulating all messages we ensure the specific root-cause
// message is always visible in the failure output alongside the generic one.
const consoleErrors: string[] = [];
const consoleWarnings: string[] = [];

const ICON_ASSET_PATH_PREFIX = '/assets/icons/';
const originalFetch = globalThis.fetch;

beforeEach(() => {
  consoleErrors.length = 0;
  consoleWarnings.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    const message = String(args[0]);
    consoleErrors.push(message);
    throw new Error(consoleErrors.join('\n---\n'));
  });
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    const message = String(args[0]);
    consoleWarnings.push(message);
    throw new Error(consoleWarnings.join('\n---\n'));
  });

  // Icon renders with `inlineSvg` fetch their markup as a side effect of mounting. Stub that
  // out by default so component tests that incidentally render one (without caring about it)
  // don't attempt a real network request — tests that do care can still override this via
  // their own vi.stubGlobal('fetch', ...).
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.startsWith(ICON_ASSET_PATH_PREFIX)) {
      return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    }

    return originalFetch(input, init);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
