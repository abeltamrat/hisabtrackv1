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
import { ActivityIndicator, View, Text } from 'react-native';
import { useDispatch } from 'react-redux';
interface User { uid: string; email: string | null; displayName?: string | null }
interface AuthContextType { user: User | null; loading: boolean; signOut: () => Promise<void>; isAuthenticated: boolean }
const AuthContext = createContext<AuthContextType | undefined>(undefined);
const transitions = createSerialQueue();
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  }, [dispatch]);
  useEffect(() => {
    if (loading || error) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = LocalChangeEmitter.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void SyncService.refreshLocalStore().catch(() => undefined); }, 250);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [loading, error, user?.uid]);
  const signOut = async () => {
    setLoading(true); SyncService.stopAutoSync();
    await BackgroundService.suspend(); await SMSSyncService.suspend(); await SyncService.settle();
    if (user) await RemotePushService.unregisterCurrentDevice(user.uid).catch(() => undefined);
    try { await AuthService.signOut(); } catch (e) { setLoading(false); throw e; }
  };
  return <AuthContext.Provider value={{ user, loading, signOut, isAuthenticated: !!user }}>
    {loading ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /><Text>Opening your data…</Text></View>
      : error ? <View style={{ flex: 1, padding: 24 }}><Text>{error}</Text><Text>Close and reopen the app to retry. Your stored data has been preserved.</Text></View>
      : <React.Fragment key={user?.uid || 'guest'}>{children}</React.Fragment>}
  </AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider is required'); return value; }
