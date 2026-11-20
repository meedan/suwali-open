import { describe, expect, it } from 'vitest';

import type { Source } from '@customTypes/source';

import { sourceSupportsPublishedAt } from './source';

describe('sourceSupportsPublishedAt', () => {
  it.each(['rss_feed', 'json_api', 'google_drive_folder'] as Source['source_type'][])('returns true for %s', (sourceType) => {
    expect(sourceSupportsPublishedAt(sourceType)).toBe(true);
  });

  it.each(['uploaded_files', 'website', 'conversation'] as Source['source_type'][])('returns false for %s', (sourceType) => {
    expect(sourceSupportsPublishedAt(sourceType)).toBe(false);
  });
});
