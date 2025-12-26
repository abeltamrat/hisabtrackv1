import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { useColorScheme as useNWColorScheme } from 'nativewind';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;                 // user preference
  actualTheme: 'light' | 'dark';// resolved theme
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = 'app-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemTheme = useColorScheme(); // OS
  const { setColorScheme } = useNWColorScheme(); // NativeWind

  const [theme, setThemeState] = useState<Theme>('system');
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>(
    systemTheme === 'dark' ? 'dark' : 'light'
  );

  // Load saved preference
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setThemeState(saved);
        }
      } catch (e) {
        console.warn('Failed to load theme', e);
      }
    })();
  }, []);

  // Resolve + apply theme
  useEffect(() => {
    const resolved: 'light' | 'dark' =
      theme === 'system'
        ? systemTheme === 'dark'
          ? 'dark'
          : 'light'
        : theme;

    setActualTheme(resolved);
    setColorScheme(resolved); // 🔑 NativeWind switch
  }, [theme, systemTheme]);

  const setTheme = async (newTheme: Theme) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, newTheme);
      setThemeState(newTheme);
    } catch (e) {
      console.warn('Failed to save theme', e);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, actualTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return ctx;
}
