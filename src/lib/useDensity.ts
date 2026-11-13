import { useState, useEffect, useCallback } from 'react';

export type Density = 'compact' | 'spacious';

const STORAGE_KEY = 'ehi-density';
export const DEFAULT_DENSITY: Density = 'spacious';

export function getSavedDensity(): Density {
  if (typeof localStorage === 'undefined') return DEFAULT_DENSITY;
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Density | null;
    if (saved === 'compact' || saved === 'spacious') return saved;
  } catch {
    // Local storage access error / sandbox
  }
  return DEFAULT_DENSITY;
}

export function applyDensity(density: Density) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-density', density);
  if (density === 'compact') {
    root.classList.add('density-compact');
    root.classList.remove('density-spacious');
  } else {
    root.classList.add('density-spacious');
    root.classList.remove('density-compact');
  }
}

export function useDensity() {
  const [density, setDensityState] = useState<Density>(() => getSavedDensity());

  useEffect(() => {
    applyDensity(density);
    try {
      localStorage.setItem(STORAGE_KEY, density);
    } catch {
      // Local storage quota or security error
    }
  }, [density]);

  const setDensity = useCallback((newDensity: Density) => {
    setDensityState(newDensity);
  }, []);

  const toggle = useCallback(() => {
    setDensityState((prev) => (prev === 'compact' ? 'spacious' : 'compact'));
  }, []);

  return {
    density,
    setDensity,
    toggle,
    isCompact: density === 'compact',
    isSpacious: density === 'spacious',
  };
}
