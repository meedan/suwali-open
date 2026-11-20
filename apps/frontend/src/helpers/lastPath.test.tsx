import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getIdFromParamsOrLastPath,
  getLastPath,
  removeLastPath,
  setLastPath,
} from './lastPath';

describe('lastPath helper', () => {
  const KEY = 'conversationsLastPath';
  const HUB_ID = 123;

  beforeEach(() => {
    localStorage.clear();
  });

  describe('storage functions', () => {
    it('should save and retrieve a scoped path', () => {
      setLastPath(KEY, HUB_ID, '/conversations/42');
      const result = getLastPath(KEY, HUB_ID);
      expect(result).toBe('/conversations/42');
    });

    it('should scope storage by hubId', () => {
      setLastPath(KEY, 1, '/conversations/1');
      setLastPath(KEY, 2, '/conversations/2');
      expect(getLastPath(KEY, 1)).toBe('/conversations/1');
      expect(getLastPath(KEY, 2)).toBe('/conversations/2');
    });

    it('should remove stored path', () => {
      setLastPath(KEY, HUB_ID, '/conversations/42');
      removeLastPath(KEY, HUB_ID);
      expect(getLastPath(KEY, HUB_ID)).toBeNull();
    });

    it('should not mix different keyNames', () => {
      setLastPath('notebooksLastPath', HUB_ID, '/notebooks/10');
      expect(getLastPath('conversationsLastPath', HUB_ID)).toBeNull();
    });

    it('should not store or read a path without a hub', () => {
      setLastPath(KEY, null, '/conversations/42');
      expect(localStorage.length).toBe(0);
      expect(getLastPath(KEY, null)).toBeNull();
    });

    it('should not throw when storage is unavailable', () => {
      const error = new Error('QuotaExceededError');
      const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw error; });
      const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw error; });
      const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw error; });

      expect(() => setLastPath(KEY, HUB_ID, '/conversations/42')).not.toThrow();
      expect(getLastPath(KEY, HUB_ID)).toBeNull();
      expect(() => removeLastPath(KEY, HUB_ID)).not.toThrow();

      setItem.mockRestore();
      getItem.mockRestore();
      removeItem.mockRestore();
    });
  });

  describe('getIdFromParamsOrLastPath', () => {
    it('should return paramsId if provided', () => {
      const result = getIdFromParamsOrLastPath(
        '55',
        KEY,
        HUB_ID,
        /\/conversations\/(\d+)/
      );
      expect(result).toBe(55);
    });

    it('should return null if no match in stored path', () => {
      setLastPath(KEY, HUB_ID, '/conversations/');
      const result = getIdFromParamsOrLastPath(
        undefined,
        KEY,
        HUB_ID,
        /\/conversations\/(\d+)/
      );
      expect(result).toBeNull();
    });
  });
});
