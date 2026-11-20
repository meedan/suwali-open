import { describe, expect, it } from 'vitest';

import { getDocumentEmbedUrl } from './document';

describe('getDocumentEmbedUrl', () => {
  it('returns the file URL for a txt document', () => {
    const fileUrl = 'https://example.com/files/notes.txt';

    expect(getDocumentEmbedUrl(null, 'txt', fileUrl)).toBe(fileUrl);
  });

  it('returns null for a markdown document, so the caller falls back to rendering content (browsers have no native text/markdown viewer)', () => {
    const fileUrl = 'https://example.com/files/notes.md';

    expect(getDocumentEmbedUrl(null, 'md', fileUrl)).toBeNull();
  });
});
