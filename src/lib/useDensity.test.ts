import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSavedDensity, applyDensity, DEFAULT_DENSITY, type Density } from './useDensity';

describe('useDensity', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;

  let storage: Record<string, string> = {};
  let rootAttributes: Record<string, string> = {};
  let rootClasses = new Set<string>();

  beforeEach(() => {
    storage = {};
    rootAttributes = {};
    rootClasses.clear();

    (globalThis as any).localStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        storage = {};
      },
    };

    (globalThis as any).document = {
      documentElement: {
        setAttribute: (attr: string, value: string) => {
          rootAttributes[attr] = value;
        },
        getAttribute: (attr: string) => rootAttributes[attr] ?? null,
        classList: {
          add: (cls: string) => rootClasses.add(cls),
          remove: (cls: string) => rootClasses.delete(cls),
          contains: (cls: string) => rootClasses.has(cls),
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    (globalThis as any).document = originalDocument;
  });

  test('returns default density (spacious) when no saved preference exists', () => {
    assert.equal(getSavedDensity(), DEFAULT_DENSITY);
    assert.equal(getSavedDensity(), 'spacious');
  });

  test('retrieves saved compact density from localStorage', () => {
    localStorage.setItem('ehi-density', 'compact');
    assert.equal(getSavedDensity(), 'compact');
  });

  test('retrieves saved spacious density from localStorage', () => {
    localStorage.setItem('ehi-density', 'spacious');
    assert.equal(getSavedDensity(), 'spacious');
  });

  test('falls back to default density on invalid stored value', () => {
    localStorage.setItem('ehi-density', 'invalid-density' as any);
    assert.equal(getSavedDensity(), DEFAULT_DENSITY);
  });

  test('applyDensity sets data-density attribute and class names on documentElement', () => {
    applyDensity('compact');
    assert.equal(rootAttributes['data-density'], 'compact');
    assert.equal(rootClasses.has('density-compact'), true);
    assert.equal(rootClasses.has('density-spacious'), false);

    applyDensity('spacious');
    assert.equal(rootAttributes['data-density'], 'spacious');
    assert.equal(rootClasses.has('density-spacious'), true);
    assert.equal(rootClasses.has('density-compact'), false);
  });
});
