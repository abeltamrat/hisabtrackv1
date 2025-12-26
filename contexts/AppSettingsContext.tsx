import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

export type AppCurrencyCode = string; // ISO 4217
export type AppLanguage = string; // i18n language code
export type AppFontSize = 'Small' | 'Medium' | 'Large';

export interface AppSettings {
  currency: AppCurrencyCode;
  language: AppLanguage;
  fontSize: AppFontSize;
  preferLocalLogos: boolean;
}

interface AppSettingsContextType extends AppSettings {
  setCurrency: (c: AppCurrencyCode) => void;
  setLanguage: (l: AppLanguage) => void;
  setFontSize: (s: AppFontSize) => void;
  setPreferLocalLogos: (v: boolean) => void;
  formatCurrency: (amount: number) => string;
}

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

const DEFAULTS: AppSettings = {
  currency: 'USD',
  language: 'en',
  fontSize: 'Medium',
  preferLocalLogos: false,
};

// simple storage helpers
async function loadSettings(): Promise<AppSettings> {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem('app_settings');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed ? { ...DEFAULTS, ...(parsed as AppSettings) } : DEFAULTS;
    } else {
      const { SecureStorageService } = await import('@/services/SecureStorageService');
      const raw = await SecureStorageService.getUserData();
      const saved = raw?.appSettings;
      return saved ? { ...DEFAULTS, ...(saved as AppSettings) } : DEFAULTS;
    }
  } catch {
    return DEFAULTS;
  }
}

async function saveSettings(s: AppSettings) {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem('app_settings', JSON.stringify(s));
    } else {
      const { SecureStorageService } = await import('@/services/SecureStorageService');
      const existing = await SecureStorageService.getUserData();
      const next = { ...(existing || {}), appSettings: s };
      await SecureStorageService.saveUserData(next);
    }
  } catch {}
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    (async () => {
      await saveSettings(settings);
      try { LocalChangeEmitter.emit(); } catch (e) { /* ignore */ }
    })();
  }, [settings]);

  const setCurrency = (currency: AppCurrencyCode) => setSettings(prev => ({ ...prev, currency }));
  const setLanguage = (language: AppLanguage) => setSettings(prev => ({ ...prev, language }));
  const setFontSize = (fontSize: AppFontSize) => setSettings(prev => ({ ...prev, fontSize }));
  const setPreferLocalLogos = (preferLocalLogos: boolean) => setSettings(prev => ({ ...prev, preferLocalLogos }));

  const formatCurrency = (amount: number) => {
    // Try Intl first for platforms/browsers with full support
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: settings.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {}

    // Fallback: consistent symbol formatting across native platforms
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      CNY: '¥',
      INR: '₹',
      ETB: 'ETB',
      AUD: 'A$',
      CAD: 'C$',
      ZAR: 'R',
      NGN: '₦',
      KES: 'KSh',
    };
    const sym = symbols[settings.currency] || settings.currency;
    return `${sym} ${amount.toFixed(2)}`;
  };

  const value = useMemo<AppSettingsContextType>(() => ({
    ...settings,
    setCurrency,
    setLanguage,
    setFontSize,
    setPreferLocalLogos,
    formatCurrency,
  }), [settings]);

  return (
    <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  if (!ctx) throw new Error('useAppSettings must be used within AppSettingsProvider');
  return ctx;
}
