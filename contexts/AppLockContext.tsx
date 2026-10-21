import AppLockScreen from '@/components/AppLockScreen';
import { ActivityIndicator, View, Text } from 'react-native';
import { AppLockService, type AppLockCloudPolicy } from '@/services/AppLockService';
import CloudProfileService, { type CloudAppLockPolicy } from '@/services/CloudProfileService';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Keyboard } from 'react-native';
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
  const { isAuthenticated, user } = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  const [appLockEnabled, setAppLockEnabledState] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [prefsError, setPrefsError] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const initialLockApplied = useRef(false);
  const appLockEnabledRef = useRef(false);

  useEffect(() => { appLockEnabledRef.current = appLockEnabled; }, [appLockEnabled]);

  // Content is first mounted after the initial unlock and then never torn down by locking.
  const [contentMounted, setContentMounted] = useState(false);
  useEffect(() => {
    if (prefsLoaded && !isLocked) setContentMounted(true);
  }, [prefsLoaded, isLocked]);
  useEffect(() => {
    if (isLocked) Keyboard.dismiss();
  }, [isLocked]);

  const applyCloudPolicy = useCallback(async (policy: CloudAppLockPolicy, lockOnChange: boolean) => {
    const [localVerifier, localEnabled, localHasPin] = await Promise.all([
      AppLockService.getPinVerifier(),
      AppLockService.isAppLockEnabled(),
      AppLockService.hasPin(),
    ]);
    const verifierChanged = policy.verifier !== localVerifier;
    const enabled = policy.enabled && !!policy.verifier;
    const policyChanged = verifierChanged || enabled !== localEnabled;

    if (policy.verifier) await AppLockService.setPinVerifier(policy.verifier);
    else if (localHasPin) await AppLockService.clearPin();
    await AppLockService.setAppLockEnabled(enabled);
    setHasPin(!!policy.verifier);
    setAppLockEnabledState(enabled);
    if (!enabled) setIsLocked(false);
    else if (lockOnChange && policyChanged && isAuthenticated) setIsLocked(true);
    return { lockEnabled: enabled, pinSet: !!policy.verifier };
  }, [isAuthenticated]);

  const publishCloudPolicy = useCallback(async (policy: AppLockCloudPolicy) => {
    if (!user?.uid) return;
    await AppLockService.setPendingCloudPolicy(policy);
    try {
      await CloudProfileService.setAppLockPolicy(user.uid, policy);
      await AppLockService.setPendingCloudPolicy(null);
    } catch {
      // Keep the pending policy on this device. It is retried when Firestore reconnects.
    }
  }, [user?.uid]);

  const loadPrefs = useCallback(async () => {
    let [lockEnabled, bioEnabled, bioAvail, pinSet] = await Promise.all([
      AppLockService.isAppLockEnabled(),
      AppLockService.isBiometricEnabled(),
      AppLockService.isBiometricAvailable(),
      AppLockService.hasPin(),
    ]);
    if (user?.uid) {
      const pending = await AppLockService.getPendingCloudPolicy();
      if (pending) {
        try {
          await CloudProfileService.setAppLockPolicy(user.uid, pending);
          await AppLockService.setPendingCloudPolicy(null);
        } catch { /* use the protected local policy while offline */ }
      }
      const cloudPolicy = await CloudProfileService.getAppLockPolicy(user.uid).catch(() => null);
      if (cloudPolicy && !pending) {
        ({ lockEnabled, pinSet } = await applyCloudPolicy(cloudPolicy, false));
      } else if (!cloudPolicy && !pending) {
        const verifier = await AppLockService.getPinVerifier();
        if (verifier) void publishCloudPolicy({ enabled: lockEnabled, verifier });
      }
    }
    setAppLockEnabledState(lockEnabled);
    setBiometricEnabledState(bioEnabled);
    setBiometricAvailable(bioAvail);
    setHasPin(pinSet);
    return { lockEnabled, pinSet };
  }, [applyCloudPolicy, publishCloudPolicy, user?.uid]);

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
  }, [loadPrefs, isAuthenticated, user?.uid]);

  // Apply app-lock changes from the same account on other devices in real time.
  useEffect(() => {
    if (!user?.uid || !prefsLoaded) return;
    return CloudProfileService.subscribeAppLockPolicy(user.uid, policy => {
      void (async () => {
        const pending = await AppLockService.getPendingCloudPolicy();
        if (pending) {
          try {
            await CloudProfileService.setAppLockPolicy(user.uid, pending);
            await AppLockService.setPendingCloudPolicy(null);
          } catch { /* Firestore will invoke this listener again after reconnecting */ }
          return;
        }
        if (policy) await applyCloudPolicy(policy, true);
      })().catch(() => undefined);
    });
  }, [applyCloudPolicy, prefsLoaded, user?.uid]);

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
    const verifier = await AppLockService.getPinVerifier();
    if (verifier) await publishCloudPolicy({ enabled: appLockEnabledRef.current, verifier });
  }, [publishCloudPolicy]);

  const clearPin = useCallback(async () => {
    await AppLockService.clearPin();
    await AppLockService.setAppLockEnabled(false);
    setHasPin(false);
    setAppLockEnabledState(false);
    setIsLocked(false);
    await publishCloudPolicy({ enabled: false, verifier: null });
  }, [publishCloudPolicy]);

  const setAppLockEnabled = useCallback(async (enabled: boolean) => {
    const verifier = await AppLockService.getPinVerifier();
    if (enabled && !verifier) throw new Error('Set a PIN before enabling app lock');
    await AppLockService.setAppLockEnabled(enabled);
    setAppLockEnabledState(enabled);
    if (!enabled) setIsLocked(false);
    await publishCloudPolicy({ enabled, verifier });
  }, [publishCloudPolicy]);

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
        : !prefsLoaded ? <ActivityIndicator /> : (
          <>
            {/* Once the app has been unlocked, keep it mounted under the lock screen so
                navigation and half-filled forms survive a background lock. */}
            {(contentMounted || !isLocked) && children}
            {isLocked && <AppLockScreen />}
          </>
        )}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within AppLockProvider');
  return ctx;
}
