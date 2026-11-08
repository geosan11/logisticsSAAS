import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';

export type LogisticsMode = 'air' | 'road' | 'intermodal';

export interface ModeContextValue {
  mode: LogisticsMode;
  setMode: (mode: LogisticsMode) => void;
  isAir: boolean;
  isRoad: boolean;
  isIntermodal: boolean;
  availableModes: LogisticsMode[];
}

const ModeContext = createContext<ModeContextValue | undefined>(undefined);

const MODE_STORAGE_PREFIX = 'ehi_logistics_mode_';

export const ModeProvider: React.FC<{
  userId?: string;
  allowedModes?: LogisticsMode[];
  children: ReactNode;
}> = ({ userId = 'default', allowedModes = ['air', 'road', 'intermodal'], children }) => {
  const storageKey = `${MODE_STORAGE_PREFIX}${userId}`;

  const [mode, setModeState] = useState<LogisticsMode>(() => {
    try {
      const saved = localStorage.getItem(storageKey) as LogisticsMode | null;
      if (saved && allowedModes.includes(saved)) {
        return saved;
      }
    } catch {}
    return allowedModes[0] || 'air';
  });

  // Keep saved mode aligned if allowedModes changes
  useEffect(() => {
    if (!allowedModes.includes(mode)) {
      setModeState(allowedModes[0] || 'air');
    }
  }, [allowedModes, mode]);

  const setMode = (newMode: LogisticsMode) => {
    if (!allowedModes.includes(newMode)) return;
    setModeState(newMode);
    try {
      localStorage.setItem(storageKey, newMode);
    } catch {}
  };

  const value = useMemo<ModeContextValue>(() => ({
    mode,
    setMode,
    isAir: mode === 'air' || mode === 'intermodal',
    isRoad: mode === 'road' || mode === 'intermodal',
    isIntermodal: mode === 'intermodal',
    availableModes: allowedModes,
  }), [mode, allowedModes]);

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
};

export function useLogisticsMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    // Graceful fallback for non-wrapped unit tests or isolated storybooks
    return {
      mode: 'intermodal',
      setMode: () => {},
      isAir: true,
      isRoad: true,
      isIntermodal: true,
      availableModes: ['air', 'road', 'intermodal'],
    };
  }
  return ctx;
}
