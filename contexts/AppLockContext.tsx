import AppLockScreen from '@/components/AppLockScreen';
import { ActivityIndicator, View, Text } from 'react-native';
import { AppLockService } from '@/services/AppLockService';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from './AuthContext';

interface AppLockContextType {
  isLocked: boolean;
  appLockEnabled: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  hasPin: boolean;
  prefsLoaded: boolean;
  lock: () => void;
  unlockWithBiometric: () => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  clearPin: () => Promise<void>;
  setAppLockEnabled: (enabled: boolean) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  refreshHasPin: () => Promise<void>;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  const [appLockEnabled, setAppLockEnabledState] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [prefsError, setPrefsError] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const initialLockApplied = useRef(false);

  const loadPrefs = useCallback(async () => {
    const [lockEnabled, bioEnabled, bioAvail, pinSet] = await Promise.all([
      AppLockService.isAppLockEnabled(),
      AppLockService.isBiometricEnabled(),
      AppLockService.isBiometricAvailable(),
      AppLockService.hasPin(),
    ]);
    setAppLockEnabledState(lockEnabled);
    setBiometricEnabledState(bioEnabled);
    setBiometricAvailable(bioAvail);
    setHasPin(pinSet);
    return { lockEnabled, pinSet };
  }, []);

  // Load preferences on mount
  useEffect(() => {
    loadPrefs().then(({ lockEnabled, pinSet }) => {
      // Lock on first load if authenticated and lock is configured
      if (!initialLockApplied.current && lockEnabled && pinSet && isAuthenticated) {
        setIsLocked(true);
        initialLockApplied.current = true;
      }
      setPrefsLoaded(true);
    }).catch(() => { setPrefsError(true); setIsLocked(true); });
  }, [loadPrefs, isAuthenticated]);

  // Lock when app goes to background (only if app lock is on and there's a PIN to unlock with)
  useEffect(() => {
    if (!appLockEnabled || !hasPin) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && nextState.match(/inactive|background/)) {
        if (isAuthenticated) setIsLocked(true);
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [appLockEnabled, hasPin, isAuthenticated]);

  // Release lock when user signs out
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLocked(false);
      initialLockApplied.current = false;
    }
  }, [isAuthenticated]);

  const lock = useCallback(() => setIsLocked(true), []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const ok = await AppLockService.authenticateWithBiometric();
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    const ok = await AppLockService.verifyPin(pin);
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const setPin = useCallback(async (pin: string) => {
    await AppLockService.setPin(pin);
    setHasPin(true);
  }, []);

  const clearPin = useCallback(async () => {
    await AppLockService.clearPin();
    setHasPin(false);
    setIsLocked(false);
  }, []);

  const setAppLockEnabled = useCallback(async (enabled: boolean) => {
    await AppLockService.setAppLockEnabled(enabled);
    setAppLockEnabledState(enabled);
    if (!enabled) setIsLocked(false);
  }, []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    await AppLockService.setBiometricEnabled(enabled);
    setBiometricEnabledState(enabled);
  }, []);

  const refreshHasPin = useCallback(async () => {
    const pinSet = await AppLockService.hasPin();
    setHasPin(pinSet);
  }, []);

  return (
    <AppLockContext.Provider value={{
      isLocked,
      appLockEnabled,
      biometricEnabled,
      biometricAvailable,
      hasPin,
      prefsLoaded,
      lock,
      unlockWithBiometric,
      unlockWithPin,
      setPin,
      clearPin,
      setAppLockEnabled,
      setBiometricEnabled,
      refreshHasPin,
    }}>
      {prefsError ? <View style={{ flex: 1, padding: 24 }}><Text>Unable to verify app lock. Restart the app to retry.</Text></View>
        : !prefsLoaded ? <ActivityIndicator /> : isLocked ? <AppLockScreen /> : children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}
