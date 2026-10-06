import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { Alert } from '@/utils/alert';
import { sessionLocalStorage, getSessionScope } from '@/services/SessionStorage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type AppCurrencyCode = string; // ISO 4217
export type AppLanguage = string; // i18n language code
export type AppFontSize = 'V.Small' | 'Small' | 'Medium' | 'Large';
export const APP_FONT_SIZE_OPTIONS: AppFontSize[] = ['V.Small', 'Small', 'Medium', 'Large'];

export const normalizeAppFontSize = (value: unknown): AppFontSize => {
  if (typeof value !== 'string') return 'Medium';

  const normalized = value.trim().toLowerCase();
  if (normalized === 'v.small' || normalized === 'vsmall' || normalized === 'very small' || normalized === 'very-small') {
    return 'V.Small';
  }
  if (normalized === 'small') return 'Small';
  if (normalized === 'large') return 'Large';
  return 'Medium';
};

export interface BackgroundReminderSettings {
  backgroundProcessingEnabled: boolean;
  backgroundSmsSyncEnabled: boolean;
  pendingDraftAlertsEnabled: boolean;
  inactivityAlertsEnabled: boolean;
  reconciliationAlertsEnabled: boolean;
  habitRemindersEnabled: boolean;
  dailySummaryAlertsEnabled: boolean;
  personalizedTipsEnabled: boolean;
}

export interface AssistantOverlaySettings {
  enabled: boolean;
  tipsEnabled: boolean;
  showOnDashboard: boolean;
  showOnTransactions: boolean;
  showOnReports: boolean;
}

export interface AppSettings {
  cloudSyncEnabled: boolean;
  aiSharingEnabled: boolean;
  currency: AppCurrencyCode;
  language: AppLanguage;
  fontSize: AppFontSize;
  preferLocalLogos: boolean;
  balancesHidden: boolean;
  geminiApiKey?: string;
  groqApiKey?: string;
  openRouterApiKey?: string;
  puterJsEnabled?: boolean;
  backgroundReminders: BackgroundReminderSettings;
  assistantOverlay: AssistantOverlaySettings;
}

interface AppSettingsContextType extends AppSettings {
  setCloudSyncEnabled: (enabled: boolean) => void;
  setAiSharingEnabled: (enabled: boolean) => void;
  setCurrency: (c: AppCurrencyCode) => void;
  setLanguage: (l: AppLanguage) => void;
  setFontSize: (s: AppFontSize) => void;
  setPreferLocalLogos: (v: boolean) => void;
  setBalancesHidden: (v: boolean) => void;
  setGeminiApiKey: (k: string) => void;
  setGroqApiKey: (k: string) => void;
  setOpenRouterApiKey: (k: string) => void;
  setPuterJsEnabled: (v: boolean) => void;
  setBackgroundProcessingEnabled: (v: boolean) => void;
  setBackgroundSmsSyncEnabled: (v: boolean) => void;
  setPendingDraftAlertsEnabled: (v: boolean) => void;
  setInactivityAlertsEnabled: (v: boolean) => void;
  setReconciliationAlertsEnabled: (v: boolean) => void;
  setHabitRemindersEnabled: (v: boolean) => void;
  setDailySummaryAlertsEnabled: (v: boolean) => void;
  setPersonalizedTipsEnabled: (v: boolean) => void;
  setAssistantEnabled: (v: boolean) => void;
  setAssistantTipsEnabled: (v: boolean) => void;
  setAssistantDashboardEnabled: (v: boolean) => void;
  setAssistantTransactionsEnabled: (v: boolean) => void;
  setAssistantReportsEnabled: (v: boolean) => void;
  formatCurrency: (amount: number) => string;
}

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

const DEFAULT_BACKGROUND_REMINDERS: BackgroundReminderSettings = {
  backgroundProcessingEnabled: true,
  backgroundSmsSyncEnabled: true,
  pendingDraftAlertsEnabled: true,
  inactivityAlertsEnabled: true,
  reconciliationAlertsEnabled: true,
  habitRemindersEnabled: true,
  dailySummaryAlertsEnabled: true,
  personalizedTipsEnabled: true,
};

const DEFAULT_ASSISTANT_OVERLAY: AssistantOverlaySettings = {
  enabled: true,
  tipsEnabled: true,
  showOnDashboard: true,
  showOnTransactions: true,
  showOnReports: true,
};

const DEFAULTS: AppSettings = {
  cloudSyncEnabled: false,
  aiSharingEnabled: false,
  currency: 'USD',
  language: 'en',
  fontSize: 'Medium',
  preferLocalLogos: false,
  balancesHidden: false,
  geminiApiKey: '',
  groqApiKey: '',
  openRouterApiKey: '',
  puterJsEnabled: false,
  backgroundReminders: DEFAULT_BACKGROUND_REMINDERS,
  assistantOverlay: DEFAULT_ASSISTANT_OVERLAY,
};

// simple storage helpers
export async function loadStoredAppSettings(): Promise<AppSettings> {
  try {
    if (Platform.OS === 'web') {
      const raw = sessionLocalStorage.getItem('app_settings');
      const parsed = raw ? JSON.parse(raw) : null;
      const merged = parsed
        ? {
          ...DEFAULTS,
          ...(parsed as AppSettings),
          backgroundReminders: {
            ...DEFAULT_BACKGROUND_REMINDERS,
            ...((parsed as AppSettings).backgroundReminders || {}),
          },
          assistantOverlay: {
            ...DEFAULT_ASSISTANT_OVERLAY,
            ...((parsed as AppSettings).assistantOverlay || {}),
          },
        }
        : DEFAULTS;
      return { ...merged, fontSize: normalizeAppFontSize((merged as AppSettings).fontSize) };
    } else {
      const { SecureStorageService } = await import('@/services/SecureStorageService');
      const raw = await SecureStorageService.getUserData();
      const saved = raw?.appSettings;
      const merged = saved
        ? {
          ...DEFAULTS,
          ...(saved as AppSettings),
          backgroundReminders: {
            ...DEFAULT_BACKGROUND_REMINDERS,
            ...((saved as AppSettings).backgroundReminders || {}),
          },
          assistantOverlay: {
            ...DEFAULT_ASSISTANT_OVERLAY,
            ...((saved as AppSettings).assistantOverlay || {}),
          },
        }
        : DEFAULTS;
      return { ...merged, fontSize: normalizeAppFontSize((merged as AppSettings).fontSize) };
    }
  } catch {
    return DEFAULTS;
  }
}

async function saveSettings(s: AppSettings) {
  const scope = getSessionScope();
  try {
    if (Platform.OS === 'web') {
      sessionLocalStorage.setItem('app_settings', JSON.stringify(s));
    } else {
      const { SecureStorageService } = await import('@/services/SecureStorageService');
      const existing = await SecureStorageService.getUserData();
      if (getSessionScope() !== scope) return;
      const next = { ...(existing || {}), appSettings: s };
      await SecureStorageService.saveUserData(next);
    }
  } catch { }
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const ledgerCurrency = useSelector((state: RootState) => state.accounts.items[0]?.currency);
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadStoredAppSettings().then(value => { setSettings(value); setSettingsLoaded(true); });
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSettings(settings);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [settings, settingsLoaded]);

  const setCloudSyncEnabled = (enabled: boolean) => {
    setSettings(prev => ({ ...prev, cloudSyncEnabled: enabled }));
    void import('@/services/SyncService').then(async ({ default: SyncService }) => {
      if (!enabled) { SyncService.stopAutoSync(); return; }
      const { AuthService } = await import('@/services/AuthService');
      const uid = AuthService.getCurrentUser()?.uid;
      if (uid) SyncService.startAutoSync(uid);
    });
  };
  const setAiSharingEnabled = (enabled: boolean) => setSettings(prev => ({ ...prev, aiSharingEnabled: enabled }));
  useEffect(() => {
    if (ledgerCurrency && settingsLoaded) setSettings(previous => previous.currency === ledgerCurrency ? previous : { ...previous, currency: ledgerCurrency });
  }, [ledgerCurrency, settingsLoaded]);
  const setCurrency = (currency: AppCurrencyCode) => {
    if (ledgerCurrency && currency !== ledgerCurrency) {
      Alert.alert('Ledger currency', `Existing balances are recorded in ${ledgerCurrency}. Currency conversion is not supported.`);
      return;
    }
    setSettings(prev => ({ ...prev, currency }));
  };
  const setLanguage = (language: AppLanguage) => setSettings(prev => ({ ...prev, language }));
  const setFontSize = (fontSize: AppFontSize) => setSettings(prev => ({ ...prev, fontSize: normalizeAppFontSize(fontSize) }));
  const setPreferLocalLogos = (preferLocalLogos: boolean) => setSettings(prev => ({ ...prev, preferLocalLogos }));
  const setBalancesHidden = (balancesHidden: boolean) => setSettings(prev => ({ ...prev, balancesHidden }));
  const setGeminiApiKey = (geminiApiKey: string) => setSettings(prev => ({ ...prev, geminiApiKey }));
  const setGroqApiKey = (groqApiKey: string) => setSettings(prev => ({ ...prev, groqApiKey }));
  const setOpenRouterApiKey = (openRouterApiKey: string) => setSettings(prev => ({ ...prev, openRouterApiKey }));
  const setPuterJsEnabled = (puterJsEnabled: boolean) => setSettings(prev => ({ ...prev, puterJsEnabled }));
  const setBackgroundProcessingEnabled = (backgroundProcessingEnabled: boolean) => setSettings(prev => ({
    ...prev,
    backgroundReminders: {
      ...prev.backgroundReminders,
      backgroundProcessingEnabled,
    },
  }));
  const setBackgroundSmsSyncEnabled = (backgroundSmsSyncEnabled: boolean) => setSettings(prev => ({
    ...prev,
    backgroundReminders: {
      ...prev.backgroundReminders,
      backgroundSmsSyncEnabled,
    },
  }));
  const setPendingDraftAlertsEnabled = (pendingDraftAlertsEnabled: boolean) => setSettings(prev => ({
    ...prev,
    backgroundReminders: {
      ...prev.backgroundReminders,
      pendingDraftAlertsEnabled,
    },
  }));
  const setInactivityAlertsEnabled = (inactivityAlertsEnabled: boolean) => setSettings(prev => ({
    ...prev,
    backgroundReminders: {
      ...prev.backgroundReminders,
      inactivityAlertsEnabled,
    },
  }));
  const setReconciliationAlertsEnabled = (reconciliationAlertsEnabled: boolean) => setSettings(prev => ({
    ...prev,
    backgroundReminders: {
      ...prev.backgroundReminders,
      reconciliationAlertsEnabled,
    },
  }));
  const setHabitRemindersEnabled = (habitRemindersEnabled: boolean) => setSettings(prev => ({
    ...prev, backgroundReminders: { ...prev.backgroundReminders, habitRemindersEnabled },
  }));
  const setDailySummaryAlertsEnabled = (dailySummaryAlertsEnabled: boolean) => setSettings(prev => ({
    ...prev, backgroundReminders: { ...prev.backgroundReminders, dailySummaryAlertsEnabled },
  }));
  const setPersonalizedTipsEnabled = (personalizedTipsEnabled: boolean) => setSettings(prev => ({
    ...prev, backgroundReminders: { ...prev.backgroundReminders, personalizedTipsEnabled },
  }));
  const setAssistantEnabled = (enabled: boolean) => setSettings(prev => ({
    ...prev,
    assistantOverlay: {
      ...prev.assistantOverlay,
      enabled,
    },
  }));
  const setAssistantTipsEnabled = (tipsEnabled: boolean) => setSettings(prev => ({
    ...prev,
    assistantOverlay: {
      ...prev.assistantOverlay,
      tipsEnabled,
    },
  }));
  const setAssistantDashboardEnabled = (showOnDashboard: boolean) => setSettings(prev => ({
    ...prev,
    assistantOverlay: {
      ...prev.assistantOverlay,
      showOnDashboard,
    },
  }));
  const setAssistantTransactionsEnabled = (showOnTransactions: boolean) => setSettings(prev => ({
    ...prev,
    assistantOverlay: {
      ...prev.assistantOverlay,
      showOnTransactions,
    },
  }));
  const setAssistantReportsEnabled = (showOnReports: boolean) => setSettings(prev => ({
    ...prev,
    assistantOverlay: {
      ...prev.assistantOverlay,
      showOnReports,
    },
  }));

  const formatCurrency = (amount: number) => {
    // Try Intl first for platforms/browsers with full support
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: settings.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch { }

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
    setCloudSyncEnabled,
    setAiSharingEnabled,
    setCurrency,
    setLanguage,
    setFontSize,
    setPreferLocalLogos,
    setBalancesHidden,
    setGeminiApiKey,
    setGroqApiKey,
    setOpenRouterApiKey,
    setPuterJsEnabled,
    setBackgroundProcessingEnabled,
    setBackgroundSmsSyncEnabled,
    setPendingDraftAlertsEnabled,
    setInactivityAlertsEnabled,
    setReconciliationAlertsEnabled,
    setHabitRemindersEnabled,
    setDailySummaryAlertsEnabled,
    setPersonalizedTipsEnabled,
    setAssistantEnabled,
    setAssistantTipsEnabled,
    setAssistantDashboardEnabled,
    setAssistantTransactionsEnabled,
    setAssistantReportsEnabled,
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
