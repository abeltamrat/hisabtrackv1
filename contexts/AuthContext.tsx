import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { AuthService } from '@/services/AuthService';
import RemotePushService from '@/services/RemotePushService';
import SyncService from '@/services/SyncService';
import { setDatabaseScope } from '@/services/database';
import { setSessionScope } from '@/services/SessionStorage';
import { AIFinancialAssistant } from '@/services/AIFinancialAssistant';
import { DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSSyncService } from '@/services/SMSSyncService';
import { BackgroundService } from '@/services/BackgroundService';
import { NotificationService } from '@/services/NotificationService';
import { loadStoredAppSettings } from './AppSettingsContext';
import { resetAccounts } from '@/store/slices/accountsSlice';
import { resetBudgets } from '@/store/slices/budgetsSlice';
import { resetLoans } from '@/store/slices/loansSlice';
import { resetTransactions } from '@/store/slices/transactionsSlice';
import { createSerialQueue } from '@/utils/asyncLock';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Appearance, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';
interface User { uid: string; email: string | null; displayName?: string | null }
interface AuthContextType { user: User | null; loading: boolean; signOut: () => Promise<void>; isAuthenticated: boolean }
const AuthContext = createContext<AuthContextType | undefined>(undefined);
const transitions = createSerialQueue();
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `retry` to re-run the auth-state effect from scratch.
  const [attempt, setAttempt] = useState(0);
  const dispatch = useDispatch();
  useEffect(() => {
    let disposed = false;
    let initialAuthEvent = true;
    let generation = 0;
    const unsubscribe = AuthService.onAuthStateChanged(firebaseUser => {
      const currentGeneration = ++generation;
      const adoptExistingSession = initialAuthEvent && !!firebaseUser;
      initialAuthEvent = false;
      setLoading(true); setError(null); SyncService.stopAutoSync();
      void transitions(async () => {
        await BackgroundService.suspend();
        await SMSSyncService.suspend();
        await SyncService.settle();
        await (await import('@/services/LinkedPaymentService')).default.suspend();
        await NotificationService.cancelAllNotifications().catch(() => undefined);
        await DraftTransactionService.settle();
        AIFinancialAssistant.clearChatHistory(); DraftTransactionService.invalidateCache();
        const legacy = await setSessionScope(firebaseUser?.uid || null, adoptExistingSession);
        await setDatabaseScope(firebaseUser?.uid || 'guest', legacy);
        if (legacy) {
          const { SecureStorageService } = await import('@/services/SecureStorageService');
          await SecureStorageService.migrateLegacy();
        }
        await (await import('@/services/RestoreService')).RestoreService.resume();
        dispatch(resetAccounts()); dispatch(resetTransactions()); dispatch(resetBudgets()); dispatch(resetLoans());
        await SyncService.refreshLocalStore();
        if (disposed || currentGeneration !== generation) return;
        setUser(firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName } : null);
        setLoading(false);
        if (firebaseUser) {
          SMSSyncService.resume(); BackgroundService.resume();
          void import('@/services/LinkedPaymentService').then(m => { if (disposed || currentGeneration !== generation) return; m.default.resume(); return m.default.retryPending(); }).catch(() => undefined);
          const settings = await loadStoredAppSettings();
          if (disposed || currentGeneration !== generation) return;
          if (settings.cloudSyncEnabled) SyncService.startAutoSync(firebaseUser.uid);
          void RemotePushService.syncCurrentDevice(firebaseUser.uid).catch(() => undefined);
        }
      }).catch(e => { if (!disposed && currentGeneration === generation) { setError(e.message || 'Unable to open your data'); setLoading(false); } });
    });
    return () => { disposed = true; unsubscribe(); SyncService.stopAutoSync(); };
  }, [dispatch, attempt]);
  useEffect(() => {
    if (loading || error) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = LocalChangeEmitter.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void SyncService.refreshLocalStore().catch(() => undefined); }, 250);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [loading, error, user?.uid]);
  const retry = async () => {
    try {
      const Updates = await import('expo-updates');
      await Updates.reloadAsync();
    } catch {
      // reloadAsync is unavailable in Expo Go and on web; re-running the auth
      // transition by remounting the subscription is the next best thing.
      setError(null);
      setLoading(true);
      setAttempt(value => value + 1);
    }
  };
  const signOut = async () => {
    setLoading(true); SyncService.stopAutoSync();
    await BackgroundService.suspend(); await SMSSyncService.suspend(); await SyncService.settle();
    if (user) await RemotePushService.unregisterCurrentDevice(user.uid).catch(() => undefined);
    try { await AuthService.signOut(); } catch (e) { setLoading(false); throw e; }
  };
  // This gate replaces the whole app, so it needs the theme background and
  // readable text; it previously rendered unstyled on a white surface in dark
  // mode. ThemeProvider sits below AuthProvider, so read the OS preference.
  const isDark = Appearance.getColorScheme() === 'dark';
  const surface = isDark ? '#0f172a' : '#f8fafc';
  const heading = isDark ? '#f8fafc' : '#0f172a';
  const muted = isDark ? '#cbd5e1' : '#475569';

  return <AuthContext.Provider value={{ user, loading, signOut, isAuthenticated: !!user }}>
    {loading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: surface }}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text accessibilityLiveRegion="polite" style={{ color: muted, marginTop: 12 }}>Opening your data…</Text>
      </View>
      : error ? <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: surface }}>
          <Text accessibilityRole="alert" style={{ color: heading, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Unable to open your data</Text>
          <Text style={{ color: muted, marginBottom: 4 }}>{error}</Text>
          <Text style={{ color: muted, marginBottom: 20 }}>Your stored data has been preserved.</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Try opening your data again"
            onPress={retry}
            style={{ backgroundColor: '#4f46e5', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '700' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      : <React.Fragment key={user?.uid || 'guest'}>{children}</React.Fragment>}
  </AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider is required'); return value; }
