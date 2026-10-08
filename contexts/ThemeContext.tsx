import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@/services/SessionStorage';
import { Platform, useColorScheme, View } from 'react-native';
import { useColorScheme as useNWColorScheme, vars } from 'nativewind';

import AuroraBackground from '@/components/aurora/AuroraBackground';
import { AURORA_VARS } from '@/components/aurora/palette';

/**
 * 'aurora' is the glass look: it runs on NativeWind's dark scheme (so every
 * `dark:` class and `actualTheme === 'dark'` branch applies) and re-tints the
 * dark surfaces to translucent glass over the aurora background.
 */
export type Theme = 'aurora' | 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;                 // user preference
  actualTheme: 'light' | 'dark';// resolved theme
  /** True while the Aurora Glass look is active. */
  isAurora: boolean;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = 'app-theme';
const auroraVars = vars(AURORA_VARS);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemTheme = useColorScheme(); // OS
  const { setColorScheme } = useNWColorScheme(); // NativeWind

  // Nothing saved means the person never chose: they get the new default look.
  // An explicit Light, Dark or System choice is always kept.
  const [theme, setThemeState] = useState<Theme>('aurora');
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('dark');

  // Load saved preference
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'aurora' || saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeState(saved);
        }
      } catch (e) {
        console.warn('Failed to load theme', e);
      }
    })();
  }, []);

  const isAurora = theme === 'aurora';

  // Resolve + apply theme
  useEffect(() => {
    const resolved: 'light' | 'dark' =
      theme === 'aurora'
        ? 'dark'
        : theme === 'system'
          ? systemTheme === 'dark'
            ? 'dark'
            : 'light'
          : theme;

    setActualTheme(resolved);
    setColorScheme(resolved); // 🔑 NativeWind switch
  }, [theme, systemTheme]);

  // On web, modals and portals render outside this view, so the glass palette
  // also goes on the document root there.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(AURORA_VARS)) {
      if (isAurora) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }, [isAurora]);

  const setTheme = async (newTheme: Theme) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, newTheme);
      setThemeState(newTheme);
    } catch (e) {
      console.warn('Failed to save theme', e);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, actualTheme, isAurora, setTheme }}>
      {/* The wrapper is always present so switching themes never remounts the app. */}
      <View style={isAurora ? [{ flex: 1 }, auroraVars] : { flex: 1 }}>
        {isAurora ? <AuroraBackground /> : null}
        {children}
      </View>
    </ThemeContext.Provider>
  );
}

/** Safe anywhere, even outside the provider (then false). */
export function useIsAurora(): boolean {
  return useContext(ThemeContext)?.isAurora ?? false;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
