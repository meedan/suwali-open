import { describe, expect, it } from 'vitest';

import {
getFirstNumericParam,
getMostLikelyPaginationParam,
getMostLikelyPaginationType,
getPathSegments,
getSlashParams,
getUrlParams,
templateToSampleUrl,
} from './WebsiteWizardPaginationCardUtil';

describe('WebsiteWizardPaginationCardUtil', () => {
describe('getUrlParams', () => {
  it('should extract query parameters from a valid URL', () => {
    const result = getUrlParams('https://example.com?page=2&sort=asc');
    expect(result).toEqual({ page: '2', sort: 'asc' });
  });

  it('should return empty object for invalid URL', () => {
    const result = getUrlParams('not a valid url');
    expect(result).toEqual({});
  });

  it('should return empty object for undefined URL', () => {
    const result = getUrlParams(undefined);
    expect(result).toEqual({});
  });

  it('should handle URL with no query parameters', () => {
    const result = getUrlParams('https://example.com');
    expect(result).toEqual({});
  });
});

describe('getPathSegments', () => {
  it('should extract path segments from URL', () => {
    const url = new URL('https://example.com/users/123/posts');
    const result = getPathSegments(url);
    expect(result).toEqual(['users', '123', 'posts']);
  });

  it('should filter out empty segments', () => {
    const url = new URL('https://example.com/users//123');
    const result = getPathSegments(url);
    expect(result).toEqual(['users', '123']);
  });

  it('should handle root path', () => {
    const url = new URL('https://example.com/');
    const result = getPathSegments(url);
    expect(result).toEqual([]);
  });
});

describe('getSlashParams', () => {
  it('should extract numeric path parameters with their preceding segment as key', () => {
    const result = getSlashParams('https://example.com/users/123/posts/456');
    expect(result).toEqual({ users: '123', posts: '456' });
  });

  it('should return empty object for undefined URL', () => {
    const result = getSlashParams(undefined);
    expect(result).toEqual({});
  });

  it('should return empty object for invalid URL', () => {
    const result = getSlashParams('not a valid url');
    expect(result).toEqual({});
  });

  it('should ignore non-numeric segments', () => {
    const result = getSlashParams('https://example.com/users/john');
    expect(result).toEqual({});
  });
});

describe('getMostLikelyPaginationParam', () => {
  it('should return the first matching common pagination parameter', () => {
    const result = getMostLikelyPaginationParam({ page: '1', start: '0' });
    expect(result).toBe('page');
  });

  it('should return null if no common pagination parameter found', () => {
    const result = getMostLikelyPaginationParam({ offset: '10' });
    expect(result).toBeNull();
  });

  it('should prioritize common params in order', () => {
    const result = getMostLikelyPaginationParam({ pagina: '2', page: '1' });
    expect(result).toBe('page');
  });
});

describe('getFirstNumericParam', () => {
  it('should return first key with numeric value', () => {
    const result = getFirstNumericParam({ filter: 'abc', limit: '10' });
    expect(result).toBe('limit');
  });

  it('should return null if no numeric parameter found', () => {
    const result = getFirstNumericParam({ name: 'john', city: 'NYC' });
    expect(result).toBeNull();
  });

  it('should handle empty object', () => {
    const result = getFirstNumericParam({});
    expect(result).toBeNull();
  });
});

describe('getMostLikelyPaginationType', () => {
  it('should return query when common query param exists', () => {
    const result = getMostLikelyPaginationType({ page: '1' }, {});
    expect(result).toBe('query');
  });

  it('should return path when common path param exists', () => {
    const result = getMostLikelyPaginationType({}, { users: '123' });
    expect(result).toBe('path');
  });

  it('should return query for first numeric query param', () => {
    const result = getMostLikelyPaginationType({ offset: '10' }, {});
    expect(result).toBe('query');
  });

  it('should return path for first numeric path param', () => {
    const result = getMostLikelyPaginationType({}, { items: '5' });
    expect(result).toBe('path');
  });

  it('should prefer query when both have params', () => {
    const result = getMostLikelyPaginationType({ page: '1' }, { users: '123' });
    expect(result).toBe('query');
  });

  it('should return query when both equal and query has params', () => {
    const result = getMostLikelyPaginationType({ a: '1' }, { b: '2' });
    expect(result).toBe('query');
  });

  it('should return null when no params exist', () => {
    const result = getMostLikelyPaginationType({}, {});
    expect(result).toBeNull();
  });
});

describe('templateToSampleUrl', () => {
  it('should replace a {page} path segment with a sample page number', () => {
    const result = templateToSampleUrl('https://example.com/page/{page}');
    expect(result).toBe('https://example.com/page/2');
  });

  it('should replace a {page} query value with a sample page number', () => {
    const result = templateToSampleUrl('https://example.com?page={page}');
    expect(result).toBe('https://example.com?page=2');
  });

  it('should return the url unchanged when there is no {page} placeholder', () => {
    const result = templateToSampleUrl('https://example.com');
    expect(result).toBe('https://example.com');
  });
});
});
